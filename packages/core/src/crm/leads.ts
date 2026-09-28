import { and, asc, count, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import {
  contact,
  contactChannel,
  lead,
  membership,
  searchProfile,
  user,
  type Db,
  type DbOrTx,
} from "@crm/db";
import {
  canTransitionLead,
  LEAD_STATUS_LABELS,
  normalizeText,
  OPEN_LEAD_STATUSES,
  parseMoney,
  type LeadStatus,
} from "@crm/shared";
import {
  assignLeadSchema,
  changeLeadStatusSchema,
  createLeadSchema,
  leadListSchema,
  saveSearchProfileSchema,
  searchProfileSchema,
} from "@crm/shared/validation/crm";
import { uuidSchema } from "@crm/shared/validation";
import type { z } from "zod";
import { scopeCondition } from "../access-filter";
import { writeAudit } from "../audit";
import { hasPermission, requirePermission, type RequestContext } from "../context";
import { ConflictError, ForbiddenError, NotFoundError, parseInput } from "../errors";
import { emitEvent } from "../events";
import { nextCode } from "../sequences";
import { insertContact } from "./contacts";
import { contactRef, leadRef, logActivity, resolveAssignment, syncLeadSearch } from "./helpers";

type SearchInput = z.output<typeof searchProfileSchema>;

function searchValues(s: SearchInput) {
  const minor = (v: string | null, currency: SearchInput["currency"]) =>
    v ? parseMoney(v, currency).amountMinor : null;
  return {
    operation: s.operation,
    propertyTypes: s.propertyTypes,
    departmentIds: s.departmentIds,
    localityIds: s.localityIds,
    neighborhoodIds: s.neighborhoodIds,
    currency: s.currency,
    priceMinMinor: minor(s.priceMin, s.currency),
    priceMaxMinor: minor(s.priceMax, s.currency),
    bedroomsMin: s.bedroomsMin,
    bathroomsMin: s.bathroomsMin,
    garagesMin: s.garagesMin,
    areaMin: s.areaMin,
    commonExpensesMaxMinor: minor(s.commonExpensesMax, s.commonExpensesCurrency),
    commonExpensesCurrency: s.commonExpensesCurrency,
    pets: s.pets,
    furnished: s.furnished,
    features: s.features,
    targetDate: s.targetDate,
    notes: s.notes,
  };
}

async function loadLeadForWrite(tx: DbOrTx, ctx: RequestContext, id: string) {
  const [row] = await tx
    .select()
    .from(lead)
    .where(and(eq(lead.id, id), eq(lead.organizationId, ctx.organizationId), isNull(lead.deletedAt)))
    .for("update");
  if (!row) throw new NotFoundError("Lead");
  return row;
}

export async function createLead(db: Db, ctx: RequestContext, rawInput: unknown) {
  requirePermission(ctx, "lead.create");
  const input = parseInput(createLeadSchema, rawInput);

  return db.transaction(async (tx) => {
    let contactId = input.contactId;
    let duplicates: Awaited<ReturnType<typeof insertContact>>["duplicates"] = [];
    if (!contactId && input.contact) {
      const created = await insertContact(tx, ctx, {
        ...input.contact,
        assignedUserId: input.contact.assignedUserId ?? input.assignedUserId,
      });
      contactId = created.contact.id;
      duplicates = created.duplicates;
    }
    if (!contactId) throw new NotFoundError("Contacto");
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
    // Crear un lead para un contacto ajeno requiere poder verlo (evita adjuntar leads a ciegas).
    requirePermission(ctx, "contact.read", contactRef(c));

    const assignedUserId = input.assignedUserId ?? ctx.userId;
    if (assignedUserId !== ctx.userId) requirePermission(ctx, "lead.assign");
    const { branchId, teamId } = await resolveAssignment(tx, ctx.organizationId, assignedUserId);

    const code = await nextCode(tx, ctx.organizationId, "LEAD");
    const [row] = await tx
      .insert(lead)
      .values({
        organizationId: ctx.organizationId,
        code,
        contactId,
        operation: input.operation,
        source: input.source,
        assignedUserId,
        branchId: input.branchId ?? branchId,
        teamId,
        notes: input.notes,
        createdById: ctx.userId,
      })
      .returning();
    if (!row) throw new Error("No se pudo crear el lead");

    await tx.insert(searchProfile).values({
      leadId: row.id,
      organizationId: ctx.organizationId,
      ...searchValues(input.search ?? searchProfileSchema.parse({ operation: input.operation })),
    });

    await syncLeadSearch(tx, [row.id]);
    await logActivity(tx, ctx, {
      type: "lead_created",
      contactId,
      leadId: row.id,
      body: input.notes,
      payload: { code, source: input.source, operation: input.operation },
    });
    await writeAudit(tx, ctx, { action: "lead.create", entityType: "lead", entityId: row.id, after: row });
    await emitEvent(tx, ctx, {
      type: "lead.created",
      aggregateType: "lead",
      aggregateId: row.id,
      payload: { contactId, assignedUserId, source: input.source },
    });
    return { lead: row, duplicates };
  });
}

export async function changeLeadStatus(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(changeLeadStatusSchema, rawInput);
  return db.transaction(async (tx) => {
    const before = await loadLeadForWrite(tx, ctx, input.leadId);
    requirePermission(ctx, "lead.update", leadRef(before));
    if (!canTransitionLead(before.status, input.status)) {
      throw new ConflictError(
        `No se puede pasar de ${LEAD_STATUS_LABELS[before.status]} a ${LEAD_STATUS_LABELS[input.status]}`,
      );
    }
    const now = new Date();
    const [after] = await tx
      .update(lead)
      .set({
        status: input.status,
        statusChangedAt: now,
        lostReason: input.status === "lost" ? (input.lostReason ?? null) : null,
        closedAt: input.status === "won" || input.status === "lost" ? now : null,
      })
      .where(eq(lead.id, before.id))
      .returning();
    await syncLeadSearch(tx, [before.id]);
    await logActivity(tx, ctx, {
      type: "lead_status_changed",
      contactId: before.contactId,
      leadId: before.id,
      body: input.note,
      payload: { from: before.status, to: input.status, lostReason: input.lostReason ?? null },
    });
    await writeAudit(tx, ctx, {
      action: "lead.status_change",
      entityType: "lead",
      entityId: before.id,
      before: { status: before.status },
      after: { status: input.status, lostReason: input.lostReason ?? null },
    });
    await emitEvent(tx, ctx, {
      type: "lead.status_changed",
      aggregateType: "lead",
      aggregateId: before.id,
      payload: { from: before.status, to: input.status },
    });
    return after;
  });
}

export async function assignLead(db: Db, ctx: RequestContext, rawInput: unknown) {
  requirePermission(ctx, "lead.assign");
  const input = parseInput(assignLeadSchema, rawInput);
  return db.transaction(async (tx) => {
    const before = await loadLeadForWrite(tx, ctx, input.leadId);
    requirePermission(ctx, "lead.assign", leadRef(before));
    if (before.assignedUserId === input.assignedUserId) return before;
    const { branchId, teamId } = await resolveAssignment(tx, ctx.organizationId, input.assignedUserId);
    const [after] = await tx
      .update(lead)
      .set({ assignedUserId: input.assignedUserId, branchId, teamId })
      .where(eq(lead.id, before.id))
      .returning();
    const [assignee] = await tx
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, input.assignedUserId));
    await syncLeadSearch(tx, [before.id]);
    await logActivity(tx, ctx, {
      type: "lead_assigned",
      contactId: before.contactId,
      leadId: before.id,
      body: `Asignado a ${assignee?.name ?? "otro usuario"}`,
      payload: { from: before.assignedUserId, to: input.assignedUserId },
    });
    await writeAudit(tx, ctx, {
      action: "lead.assignment_change",
      entityType: "lead",
      entityId: before.id,
      before: { assignedUserId: before.assignedUserId, branchId: before.branchId, teamId: before.teamId },
      after: { assignedUserId: input.assignedUserId, branchId, teamId },
    });
    await emitEvent(tx, ctx, {
      type: "lead.assigned",
      aggregateType: "lead",
      aggregateId: before.id,
      payload: { assignedUserId: input.assignedUserId },
    });
    return after;
  });
}

export async function saveSearchProfile(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(saveSearchProfileSchema, rawInput);
  return db.transaction(async (tx) => {
    const l = await loadLeadForWrite(tx, ctx, input.leadId);
    requirePermission(ctx, "lead.update", leadRef(l));
    const [before] = await tx.select().from(searchProfile).where(eq(searchProfile.leadId, l.id));
    const values = searchValues(input.search);
    const [after] = await tx
      .insert(searchProfile)
      .values({ leadId: l.id, organizationId: ctx.organizationId, ...values })
      .onConflictDoUpdate({ target: searchProfile.leadId, set: values })
      .returning();
    await logActivity(tx, ctx, { type: "search_updated", contactId: l.contactId, leadId: l.id });
    await writeAudit(tx, ctx, {
      action: "lead.search_update",
      entityType: "lead",
      entityId: l.id,
      before,
      after,
    });
    await emitEvent(tx, ctx, { type: "lead.search_updated", aggregateType: "lead", aggregateId: l.id });
    return after;
  });
}

export async function listLeads(db: DbOrTx, ctx: RequestContext, rawQuery: unknown) {
  requirePermission(ctx, "lead.read");
  const q = parseInput(leadListSchema, rawQuery);
  const conditions: (SQL | undefined)[] = [
    eq(lead.organizationId, ctx.organizationId),
    isNull(lead.deletedAt),
    scopeCondition(ctx, "lead.read", {
      ownerUserId: lead.assignedUserId,
      branchId: lead.branchId,
      teamId: lead.teamId,
    }),
  ];
  if (q.status === "open") conditions.push(inArray(lead.status, [...OPEN_LEAD_STATUSES]));
  else if (q.status) conditions.push(eq(lead.status, q.status));
  if (q.operation) conditions.push(eq(lead.operation, q.operation));
  if (q.assignedUserId) conditions.push(eq(lead.assignedUserId, q.assignedUserId));
  if (q.unattended) conditions.push(and(eq(lead.status, "new"), isNull(lead.firstContactedAt)));
  if (q.q) {
    const term = `%${normalizeText(q.q)}%`;
    conditions.push(
      or(sql`lower(unaccent(${contact.displayName})) like ${term}`, sql`lower(${lead.code}) like ${term}`),
    );
  }
  const where = and(...conditions);

  const [rows, totals] = await Promise.all([
    db
      .select({
        id: lead.id,
        code: lead.code,
        status: lead.status,
        operation: lead.operation,
        source: lead.source,
        createdAt: lead.createdAt,
        lastContactAt: lead.lastContactAt,
        firstContactedAt: lead.firstContactedAt,
        contactId: contact.id,
        contactName: contact.displayName,
        assignedName: user.name,
      })
      .from(lead)
      .innerJoin(contact, eq(contact.id, lead.contactId))
      .leftJoin(user, eq(user.id, lead.assignedUserId))
      .where(where)
      .orderBy(desc(lead.createdAt), desc(lead.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ total: count() }).from(lead).innerJoin(contact, eq(contact.id, lead.contactId)).where(where),
  ]);

  const contactIds = [...new Set(rows.map((r) => r.contactId))];
  const phones = contactIds.length
    ? await db
        .select({
          contactId: contactChannel.contactId,
          value: contactChannel.value,
          type: contactChannel.type,
        })
        .from(contactChannel)
        .where(and(inArray(contactChannel.contactId, contactIds), eq(contactChannel.isPrimary, true)))
    : [];

  return {
    items: rows.map((r) => ({
      ...r,
      phone: phones.find((p) => p.contactId === r.contactId && p.type !== "email")?.value ?? null,
      unattended: r.status === "new" && !r.firstContactedAt,
    })),
    total: totals[0]?.total ?? 0,
    page: q.page,
    pageSize: q.pageSize,
  };
}

/** Conteos por etapa del embudo y leads sin atender, filtrados por el alcance del usuario. */
export async function leadStats(db: DbOrTx, ctx: RequestContext, options: { since?: Date } = {}) {
  if (!hasPermission(ctx, "lead.read")) return null;
  const scope = scopeCondition(ctx, "lead.read", {
    ownerUserId: lead.assignedUserId,
    branchId: lead.branchId,
    teamId: lead.teamId,
  });
  const base = and(eq(lead.organizationId, ctx.organizationId), isNull(lead.deletedAt), scope);
  const byStatus = await db
    .select({ status: lead.status, n: count() })
    .from(lead)
    .where(base)
    .groupBy(lead.status);
  const [unattended] = await db
    .select({ n: count() })
    .from(lead)
    .where(and(base, eq(lead.status, "new"), isNull(lead.firstContactedAt)));
  const since = options.since ?? new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const [recent] = await db
    .select({ n: count() })
    .from(lead)
    .where(and(base, sql`${lead.createdAt} >= ${since.toISOString()}`));
  const counts = Object.fromEntries(byStatus.map((s) => [s.status, s.n])) as Partial<
    Record<LeadStatus, number>
  >;
  return { byStatus: counts, unattended: unattended?.n ?? 0, newLast30Days: recent?.n ?? 0 };
}

export async function getLead(db: DbOrTx, ctx: RequestContext, leadId: string) {
  const id = parseInput(uuidSchema, leadId);
  const [row] = await db
    .select({ lead, contactName: contact.displayName, contactKind: contact.kind, assignedName: user.name })
    .from(lead)
    .innerJoin(contact, eq(contact.id, lead.contactId))
    .leftJoin(user, eq(user.id, lead.assignedUserId))
    .where(and(eq(lead.id, id), eq(lead.organizationId, ctx.organizationId), isNull(lead.deletedAt)));
  if (!row) throw new NotFoundError("Lead");
  const ref = leadRef(row.lead);
  // Sin permiso se responde "no encontrado": no se confirma que el registro exista.
  if (!hasPermission(ctx, "lead.read", ref)) throw new NotFoundError("Lead");

  const [search] = await db.select().from(searchProfile).where(eq(searchProfile.leadId, id));
  const channels = await db
    .select()
    .from(contactChannel)
    .where(eq(contactChannel.contactId, row.lead.contactId))
    .orderBy(desc(contactChannel.isPrimary));

  return {
    lead: row.lead,
    contact: { id: row.lead.contactId, displayName: row.contactName, kind: row.contactKind, channels },
    assignedName: row.assignedName,
    search: search ?? null,
    permissions: {
      update: hasPermission(ctx, "lead.update", ref),
      assign: hasPermission(ctx, "lead.assign", ref),
    },
  };
}

/** Usuarios a los que se puede asignar trabajo comercial (para selectores). */
export async function listAssignees(db: DbOrTx, ctx: RequestContext) {
  if (!hasPermission(ctx, "lead.assign")) throw new ForbiddenError();
  return db
    .select({ userId: user.id, name: user.name })
    .from(membership)
    .innerJoin(user, eq(user.id, membership.userId))
    .where(and(eq(membership.organizationId, ctx.organizationId), eq(membership.status, "active")))
    .orderBy(asc(user.name));
}
