import { aliasedTable, and, asc, count, desc, eq, gte, isNull, lt, sql, type SQL } from "drizzle-orm";
import { calendarEvent, contact, lead, membership, property, user, type Db, type DbOrTx } from "@crm/db";
import {
  EVENT_TYPE_LABELS,
  VISIT_OUTCOME_LABELS,
  canCloseEvent,
  isVisitType,
  type ActivityType,
  type EventType,
} from "@crm/shared";
import {
  closeEventSchema,
  createEventSchema,
  eventListSchema,
  reopenEventSchema,
  updateEventSchema,
} from "@crm/shared/validation/agenda";
import { uuidSchema } from "@crm/shared/validation";
import type { PermissionCode, ResourceRef } from "@crm/shared/rbac";
import type { z } from "zod";
import { scopeCondition } from "../access-filter";
import { writeAudit } from "../audit";
import { hasPermission, requirePermission, type RequestContext } from "../context";
import { ConflictError, NotFoundError, ValidationError, parseInput } from "../errors";
import { emitEvent } from "../events";
import { contactRef, leadRef, logActivity, resolveAssignment } from "../crm/helpers";
import { propertyDisplayTitle, propertyRef } from "../properties/helpers";

type EventRow = typeof calendarEvent.$inferSelect;

export function eventRef(
  e: Pick<EventRow, "organizationId" | "assignedUserId" | "branchId" | "teamId">,
): ResourceRef {
  return {
    organizationId: e.organizationId,
    ownerUserId: e.assignedUserId,
    branchId: e.branchId,
    teamId: e.teamId,
  };
}

/** Las visitas se gobiernan con `visit.*`; el resto de la agenda con `task.*`. */
function manageCode(type: EventType): PermissionCode {
  return isVisitType(type) ? "visit.manage" : "task.manage";
}

function readCode(type: EventType): PermissionCode {
  return isVisitType(type) ? "visit.read" : "calendar.read";
}

function canRead(ctx: RequestContext, e: EventRow): boolean {
  const ref = eventRef(e);
  return hasPermission(ctx, "calendar.read", ref) || hasPermission(ctx, readCode(e.type), ref);
}

const ACTIVITY_FOR: Record<EventType, ActivityType> = {
  visit: "visit",
  meeting: "meeting",
  call: "call",
  reminder: "task",
  task: "task",
  other: "task",
};

type EventInput = z.output<typeof createEventSchema>;

/**
 * Valida que contacto, lead y propiedad existan en la organización y que quien agenda pueda
 * verlos. Si viene un lead sin contacto, se toma el contacto del lead.
 */
async function resolveLinks(tx: DbOrTx, ctx: RequestContext, input: EventInput) {
  let contactId = input.contactId;
  if (input.leadId) {
    const [l] = await tx
      .select()
      .from(lead)
      .where(
        and(eq(lead.id, input.leadId), eq(lead.organizationId, ctx.organizationId), isNull(lead.deletedAt)),
      );
    if (!l || !hasPermission(ctx, "lead.read", leadRef(l))) throw new NotFoundError("Lead");
    if (contactId && contactId !== l.contactId)
      throw new ValidationError("El lead pertenece a otro contacto", {
        leadId: ["No corresponde al contacto"],
      });
    contactId = l.contactId;
  }
  if (contactId) {
    const [c] = await tx
      .select()
      .from(contact)
      .where(
        and(
          eq(contact.id, contactId),
          eq(contact.organizationId, ctx.organizationId),
          isNull(contact.deletedAt),
        ),
      );
    if (!c) throw new NotFoundError("Contacto");
    const ref = contactRef(c);
    if (!hasPermission(ctx, "contact.read", ref) && !hasPermission(ctx, "lead.read", ref))
      throw new NotFoundError("Contacto");
  }
  if (input.propertyId) {
    const [p] = await tx
      .select()
      .from(property)
      .where(
        and(
          eq(property.id, input.propertyId),
          eq(property.organizationId, ctx.organizationId),
          isNull(property.deletedAt),
        ),
      );
    if (!p || !hasPermission(ctx, "property.read", propertyRef(p))) throw new NotFoundError("Propiedad");
  }
  return { contactId: contactId ?? null, leadId: input.leadId, propertyId: input.propertyId };
}

async function loadForWrite(tx: DbOrTx, ctx: RequestContext, id: string) {
  const [row] = await tx
    .select()
    .from(calendarEvent)
    .where(
      and(
        eq(calendarEvent.id, id),
        eq(calendarEvent.organizationId, ctx.organizationId),
        isNull(calendarEvent.deletedAt),
      ),
    )
    .for("update");
  if (!row || !canRead(ctx, row)) throw new NotFoundError("Evento");
  return row;
}

export async function createEvent(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(createEventSchema, rawInput);
  requirePermission(ctx, manageCode(input.type));
  return db.transaction(async (tx) => {
    const links = await resolveLinks(tx, ctx, input);
    const assignedUserId = input.assignedUserId ?? ctx.userId;
    const { branchId, teamId } = await resolveAssignment(tx, ctx.organizationId, assignedUserId);
    // Agendar para otro exige alcance sobre el responsable resultante.
    requirePermission(ctx, manageCode(input.type), {
      organizationId: ctx.organizationId,
      ownerUserId: assignedUserId,
      branchId,
      teamId,
    });

    const [row] = await tx
      .insert(calendarEvent)
      .values({
        organizationId: ctx.organizationId,
        type: input.type,
        title: input.title,
        description: input.description,
        location: input.location,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        allDay: input.allDay,
        ...links,
        assignedUserId,
        branchId,
        teamId,
        createdById: ctx.userId,
      })
      .returning();
    if (!row) throw new Error("No se pudo crear el evento");

    await writeAudit(tx, ctx, {
      action: "event.create",
      entityType: "calendar_event",
      entityId: row.id,
      after: row,
    });
    await emitEvent(tx, ctx, {
      type: "calendar_event.created",
      aggregateType: "calendar_event",
      aggregateId: row.id,
      payload: {
        type: row.type,
        assignedUserId,
        startsAt: row.startsAt.toISOString(),
        propertyId: row.propertyId,
      },
    });
    return row;
  });
}

export async function updateEvent(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(updateEventSchema, rawInput);
  return db.transaction(async (tx) => {
    const before = await loadForWrite(tx, ctx, input.id);
    requirePermission(ctx, manageCode(before.type), eventRef(before));
    requirePermission(ctx, manageCode(input.type), eventRef(before));
    if (!canCloseEvent(before.status))
      throw new ConflictError("Un evento cerrado no se edita: reprogramalo.");

    const links = await resolveLinks(tx, ctx, input);
    const assignedUserId = input.assignedUserId ?? before.assignedUserId;
    let { branchId, teamId } = before;
    if (assignedUserId !== before.assignedUserId) {
      ({ branchId, teamId } = await resolveAssignment(tx, ctx.organizationId, assignedUserId));
      requirePermission(ctx, manageCode(input.type), {
        organizationId: ctx.organizationId,
        ownerUserId: assignedUserId,
        branchId,
        teamId,
      });
    }

    const [after] = await tx
      .update(calendarEvent)
      .set({
        type: input.type,
        title: input.title,
        description: input.description,
        location: input.location,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        allDay: input.allDay,
        ...links,
        assignedUserId,
        branchId,
        teamId,
      })
      .where(eq(calendarEvent.id, before.id))
      .returning();
    await writeAudit(tx, ctx, {
      action: "event.update",
      entityType: "calendar_event",
      entityId: before.id,
      before,
      after,
    });
    if (before.startsAt.getTime() !== input.startsAt.getTime()) {
      await emitEvent(tx, ctx, {
        type: "calendar_event.rescheduled",
        aggregateType: "calendar_event",
        aggregateId: before.id,
        payload: { from: before.startsAt.toISOString(), to: input.startsAt.toISOString() },
      });
    }
    return after;
  });
}

/** Cierra un evento: realizado, cancelado o "no se presentó". El resultado queda en el timeline. */
export async function closeEvent(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(closeEventSchema, rawInput);
  return db.transaction(async (tx) => {
    const before = await loadForWrite(tx, ctx, input.id);
    requirePermission(ctx, manageCode(before.type), eventRef(before));
    if (!canCloseEvent(before.status)) throw new ConflictError("El evento ya está cerrado");
    const isVisit = isVisitType(before.type);
    if (!isVisit && (input.outcome || input.rating))
      throw new ValidationError("Solo las visitas llevan resultado", { outcome: ["Solo para visitas"] });
    if (isVisit && input.status === "done" && !input.outcome)
      throw new ValidationError("Indicá cómo salió la visita", { outcome: ["Requerido"] });

    const now = new Date();
    const [after] = await tx
      .update(calendarEvent)
      .set({
        status: input.status,
        outcome: input.status === "done" ? input.outcome : null,
        rating: input.status === "done" ? input.rating : null,
        feedback: input.feedback,
        closedAt: now,
        closedById: ctx.userId,
      })
      .where(eq(calendarEvent.id, before.id))
      .returning();

    if (before.contactId && input.status === "done") {
      const outcome = input.outcome ? ` · ${VISIT_OUTCOME_LABELS[input.outcome]}` : "";
      await logActivity(tx, ctx, {
        type: ACTIVITY_FOR[before.type],
        contactId: before.contactId,
        leadId: before.leadId,
        body: input.feedback ?? `${EVENT_TYPE_LABELS[before.type]}: ${before.title}${outcome}`,
        payload: {
          eventId: before.id,
          propertyId: before.propertyId,
          outcome: input.outcome,
          rating: input.rating,
        },
        occurredAt: before.startsAt,
      });
    }
    await writeAudit(tx, ctx, {
      action: "event.close",
      entityType: "calendar_event",
      entityId: before.id,
      before: { status: before.status },
      after: { status: input.status, outcome: input.outcome, rating: input.rating },
    });
    await emitEvent(tx, ctx, {
      type: isVisit && input.status === "done" ? "visit.completed" : "calendar_event.closed",
      aggregateType: "calendar_event",
      aggregateId: before.id,
      payload: {
        status: input.status,
        outcome: input.outcome,
        propertyId: before.propertyId,
        contactId: before.contactId,
        leadId: before.leadId,
      },
    });
    return after;
  });
}

/** Vuelve a agendar un evento cerrado (cancelado, no se presentó o para repetir la visita). */
export async function reopenEvent(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(reopenEventSchema, rawInput);
  if (input.endsAt && input.endsAt < input.startsAt)
    throw new ValidationError("La hora de fin es anterior al inicio", { endsAt: ["Anterior al inicio"] });
  return db.transaction(async (tx) => {
    const before = await loadForWrite(tx, ctx, input.id);
    requirePermission(ctx, manageCode(before.type), eventRef(before));
    if (before.status === "scheduled") throw new ConflictError("El evento ya está agendado");
    const [after] = await tx
      .update(calendarEvent)
      .set({
        status: "scheduled",
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        outcome: null,
        rating: null,
        closedAt: null,
        closedById: null,
      })
      .where(eq(calendarEvent.id, before.id))
      .returning();
    await writeAudit(tx, ctx, {
      action: "event.reopen",
      entityType: "calendar_event",
      entityId: before.id,
      before: { status: before.status, startsAt: before.startsAt },
      after: { status: "scheduled", startsAt: input.startsAt },
    });
    await emitEvent(tx, ctx, {
      type: "calendar_event.rescheduled",
      aggregateType: "calendar_event",
      aggregateId: before.id,
      payload: { from: before.startsAt.toISOString(), to: input.startsAt.toISOString() },
    });
    return after;
  });
}

/** Baja lógica. */
export async function deleteEvent(db: Db, ctx: RequestContext, eventId: string) {
  const id = parseInput(uuidSchema, eventId);
  return db.transaction(async (tx) => {
    const before = await loadForWrite(tx, ctx, id);
    requirePermission(ctx, manageCode(before.type), eventRef(before));
    await tx.update(calendarEvent).set({ deletedAt: new Date() }).where(eq(calendarEvent.id, id));
    await writeAudit(tx, ctx, { action: "event.delete", entityType: "calendar_event", entityId: id, before });
  });
}

// ---------------------------------------------------------------------------------------------
// Lecturas
// ---------------------------------------------------------------------------------------------

const assignee = aliasedTable(user, "assignee");

function readScope(ctx: RequestContext): SQL {
  const columns = {
    ownerUserId: calendarEvent.assignedUserId,
    branchId: calendarEvent.branchId,
    teamId: calendarEvent.teamId,
  };
  // Quien ve visitas pero no la agenda (p. ej. un rol a medida) igual ve las visitas.
  return sql`(${scopeCondition(ctx, "calendar.read", columns)} or (${calendarEvent.type} = 'visit' and ${scopeCondition(
    ctx,
    "visit.read",
    columns,
  )}))`;
}

function selectEvents(db: DbOrTx) {
  return db
    .select({
      e: calendarEvent,
      contactName: contact.displayName,
      propertyCode: property.code,
      propertyTitle: property.title,
      propertyType: property.type,
      assignedName: assignee.name,
    })
    .from(calendarEvent)
    .leftJoin(contact, eq(contact.id, calendarEvent.contactId))
    .leftJoin(property, eq(property.id, calendarEvent.propertyId))
    .leftJoin(assignee, eq(assignee.id, calendarEvent.assignedUserId));
}

type SelectedRow = Awaited<ReturnType<ReturnType<typeof selectEvents>["where"]>>[number];

function present(ctx: RequestContext, r: SelectedRow) {
  const e = r.e;
  return {
    ...e,
    contactName: e.contactId ? r.contactName : null,
    propertyLabel:
      e.propertyId && r.propertyCode && r.propertyType
        ? propertyDisplayTitle({ title: r.propertyTitle, type: r.propertyType, code: r.propertyCode })
        : null,
    propertyCode: r.propertyCode,
    assignedName: r.assignedName,
    canManage: hasPermission(ctx, manageCode(e.type), eventRef(e)),
  };
}
export type AgendaEvent = ReturnType<typeof present>;

const MAX_EVENTS = 1000;

export async function listEvents(db: DbOrTx, ctx: RequestContext, rawQuery: unknown) {
  requirePermission(ctx, "calendar.read");
  const q = parseInput(eventListSchema, rawQuery);
  if (q.to.getTime() - q.from.getTime() > 120 * 86_400_000)
    throw new ValidationError("El rango máximo es de 120 días", { to: ["Rango demasiado largo"] });
  const conditions: (SQL | undefined)[] = [
    eq(calendarEvent.organizationId, ctx.organizationId),
    isNull(calendarEvent.deletedAt),
    readScope(ctx),
    lt(calendarEvent.startsAt, q.to),
    // Incluye eventos que empezaron antes del rango y siguen en curso.
    sql`coalesce(${calendarEvent.endsAt}, ${calendarEvent.startsAt}) >= ${q.from.toISOString()}`,
  ];
  if (q.type) conditions.push(eq(calendarEvent.type, q.type));
  if (q.status) conditions.push(eq(calendarEvent.status, q.status));
  if (q.assignedUserId) conditions.push(eq(calendarEvent.assignedUserId, q.assignedUserId));
  if (q.contactId) conditions.push(eq(calendarEvent.contactId, q.contactId));
  if (q.propertyId) conditions.push(eq(calendarEvent.propertyId, q.propertyId));
  const rows = await selectEvents(db)
    .where(and(...conditions))
    .orderBy(asc(calendarEvent.startsAt))
    .limit(MAX_EVENTS);
  return rows.map((r) => present(ctx, r));
}

export async function getEvent(db: DbOrTx, ctx: RequestContext, eventId: string) {
  const id = parseInput(uuidSchema, eventId);
  const [row] = await selectEvents(db).where(
    and(
      eq(calendarEvent.id, id),
      eq(calendarEvent.organizationId, ctx.organizationId),
      isNull(calendarEvent.deletedAt),
    ),
  );
  if (!row || !canRead(ctx, row.e)) throw new NotFoundError("Evento");
  return present(ctx, row);
}

/** Próximos eventos y últimos cerrados de un contacto o propiedad (fichas). */
export async function eventsFor(
  db: DbOrTx,
  ctx: RequestContext,
  target: { contactId?: string; propertyId?: string },
) {
  if (!hasPermission(ctx, "calendar.read") && !hasPermission(ctx, "visit.read")) return null;
  const cond = target.contactId
    ? eq(calendarEvent.contactId, parseInput(uuidSchema, target.contactId))
    : target.propertyId
      ? eq(calendarEvent.propertyId, parseInput(uuidSchema, target.propertyId))
      : sql`false`;
  const rows = await selectEvents(db)
    .where(
      and(
        eq(calendarEvent.organizationId, ctx.organizationId),
        isNull(calendarEvent.deletedAt),
        readScope(ctx),
        cond,
      ),
    )
    .orderBy(desc(calendarEvent.startsAt))
    .limit(50);
  const items = rows.map((r) => present(ctx, r));
  return {
    upcoming: items.filter((e) => e.status === "scheduled").reverse(),
    past: items.filter((e) => e.status !== "scheduled"),
  };
}

/**
 * Lo que alimenta el dashboard: la agenda de hoy del usuario, las visitas que ya pasaron y
 * siguen abiertas (según su alcance) y cuántos eventos tiene en los próximos 7 días.
 */
export async function agendaOverview(db: DbOrTx, ctx: RequestContext, now = new Date()) {
  if (!hasPermission(ctx, "calendar.read")) return null;
  const tz = ctx.organization.timezone || "America/Montevideo";
  const base = and(
    eq(calendarEvent.organizationId, ctx.organizationId),
    isNull(calendarEvent.deletedAt),
    readScope(ctx),
  );
  const nowIso = now.toISOString();
  const today = sql`(${calendarEvent.startsAt} at time zone ${tz})::date = (${nowIso}::timestamptz at time zone ${tz})::date`;

  const [todayRows, pendingRows, [upcoming]] = await Promise.all([
    selectEvents(db)
      .where(
        and(
          base,
          eq(calendarEvent.assignedUserId, ctx.userId),
          today,
          sql`${calendarEvent.status} <> 'cancelled'`,
        ),
      )
      .orderBy(asc(calendarEvent.startsAt)),
    selectEvents(db)
      .where(
        and(
          base,
          eq(calendarEvent.status, "scheduled"),
          sql`coalesce(${calendarEvent.endsAt}, ${calendarEvent.startsAt}) < ${nowIso}`,
        ),
      )
      .orderBy(desc(calendarEvent.startsAt))
      .limit(20),
    db
      .select({ n: count() })
      .from(calendarEvent)
      .where(
        and(
          base,
          eq(calendarEvent.assignedUserId, ctx.userId),
          eq(calendarEvent.status, "scheduled"),
          gte(calendarEvent.startsAt, now),
          lt(calendarEvent.startsAt, new Date(now.getTime() + 7 * 86_400_000)),
        ),
      ),
  ]);
  const pending = pendingRows.map((r) => present(ctx, r));
  return {
    today: todayRows.map((r) => present(ctx, r)),
    pendingClose: pending,
    pendingVisits: pending.filter((e) => e.type === "visit").length,
    upcoming7Days: upcoming?.n ?? 0,
  };
}

/**
 * Personas a las que se puede agendar un evento. Solo quien puede agendar para otros
 * (asignar leads o gestionar visitas de toda la organización) recibe la lista.
 */
export async function listAgendaAssignees(db: DbOrTx, ctx: RequestContext) {
  const other = { organizationId: ctx.organizationId, ownerUserId: null, branchId: null, teamId: null };
  if (!hasPermission(ctx, "lead.assign") && !hasPermission(ctx, "visit.manage", other)) return null;
  return db
    .select({ userId: user.id, name: user.name })
    .from(membership)
    .innerJoin(user, eq(user.id, membership.userId))
    .where(and(eq(membership.organizationId, ctx.organizationId), eq(membership.status, "active")))
    .orderBy(asc(user.name));
}
