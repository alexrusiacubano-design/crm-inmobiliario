import { and, asc, desc, eq, inArray, isNull, lt, notInArray, or, sql, type SQL } from "drizzle-orm";
import {
  activity,
  contact,
  department,
  lead,
  locality,
  neighborhood,
  searchDocument,
  user,
  type Db,
  type DbOrTx,
} from "@crm/db";
import { normalizeText } from "@crm/shared";
import { globalSearchSchema, interactionSchema } from "@crm/shared/validation/crm";
import { uuidSchema } from "@crm/shared/validation";
import { z } from "zod";
import { scopeCondition } from "../access-filter";
import { writeAudit } from "../audit";
import { hasPermission, requirePermission, type RequestContext } from "../context";
import { NotFoundError, parseInput } from "../errors";
import { emitEvent } from "../events";
import { contactRef, leadRef, logActivity, syncLeadSearch } from "./helpers";

const timelineQuery = z.object({
  contactId: uuidSchema.optional(),
  leadId: uuidSchema.optional(),
  before: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(5).max(100).default(30),
});

/**
 * Timeline paginado por cursor (fecha). Desde un contacto se ven sus eventos y los de todos
 * sus leads visibles; desde un lead, solo los del lead.
 */
export async function listTimeline(db: DbOrTx, ctx: RequestContext, rawQuery: unknown) {
  const q = parseInput(timelineQuery, rawQuery);
  const conditions: SQL[] = [eq(activity.organizationId, ctx.organizationId)];

  if (q.leadId) {
    const [l] = await db
      .select()
      .from(lead)
      .where(and(eq(lead.id, q.leadId), eq(lead.organizationId, ctx.organizationId)));
    if (!l || !hasPermission(ctx, "lead.read", leadRef(l))) throw new NotFoundError("Lead");
    conditions.push(eq(activity.leadId, q.leadId));
  } else if (q.contactId) {
    const [c] = await db
      .select()
      .from(contact)
      .where(and(eq(contact.id, q.contactId), eq(contact.organizationId, ctx.organizationId)));
    if (
      !c ||
      !(hasPermission(ctx, "contact.read", contactRef(c)) || hasPermission(ctx, "owner.read", contactRef(c)))
    ) {
      throw new NotFoundError("Contacto");
    }
    // Eventos de leads que el usuario no puede ver quedan fuera.
    const leads = await db.select().from(lead).where(eq(lead.contactId, q.contactId));
    const hidden = leads.filter((l) => !hasPermission(ctx, "lead.read", leadRef(l))).map((l) => l.id);
    conditions.push(eq(activity.contactId, q.contactId));
    if (hidden.length) {
      conditions.push(or(isNull(activity.leadId), notInArray(activity.leadId, hidden)) as SQL);
    }
  } else {
    throw new NotFoundError("Timeline");
  }
  if (q.before) conditions.push(lt(activity.occurredAt, q.before));

  const rows = await db
    .select({
      id: activity.id,
      type: activity.type,
      direction: activity.direction,
      body: activity.body,
      payload: activity.payload,
      occurredAt: activity.occurredAt,
      leadId: activity.leadId,
      leadCode: lead.code,
      actorName: user.name,
    })
    .from(activity)
    .leftJoin(user, eq(user.id, activity.actorUserId))
    .leftJoin(lead, eq(lead.id, activity.leadId))
    .where(and(...conditions))
    .orderBy(desc(activity.occurredAt), desc(activity.id))
    .limit(q.limit + 1);

  return {
    items: rows.slice(0, q.limit),
    nextCursor: rows.length > q.limit ? (rows[q.limit - 1]?.occurredAt.toISOString() ?? null) : null,
  };
}

/**
 * Registra una interacción manual (llamada, WhatsApp, email, reunión o nota). No envía nada:
 * los envíos reales llegan con los providers de la Fase 10. En un lead, la primera
 * interacción con el cliente lo pasa de "Nuevo" a "Contactado".
 */
export async function logInteraction(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(interactionSchema, rawInput);
  return db.transaction(async (tx) => {
    let contactId = input.contactId;
    let leadRow: typeof lead.$inferSelect | undefined;
    if (input.leadId) {
      [leadRow] = await tx
        .select()
        .from(lead)
        .where(
          and(eq(lead.id, input.leadId), eq(lead.organizationId, ctx.organizationId), isNull(lead.deletedAt)),
        )
        .for("update");
      if (!leadRow) throw new NotFoundError("Lead");
      requirePermission(ctx, "lead.update", leadRef(leadRow));
      contactId = leadRow.contactId;
    } else if (contactId) {
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
      if (
        !hasPermission(ctx, "contact.update", contactRef(c)) &&
        !hasPermission(ctx, "owner.update", contactRef(c))
      ) {
        requirePermission(ctx, "contact.update", contactRef(c));
      }
    }

    const occurredAt = input.occurredAt ?? new Date();
    await logActivity(tx, ctx, {
      type: input.type,
      contactId,
      leadId: leadRow?.id ?? null,
      body: input.body,
      direction: input.direction ?? null,
      occurredAt,
    });

    if (leadRow && input.type !== "note") {
      const autoContacted = leadRow.status === "new";
      await tx
        .update(lead)
        .set({
          lastContactAt: occurredAt,
          firstContactedAt: leadRow.firstContactedAt ?? occurredAt,
          ...(autoContacted ? { status: "contacted" as const, statusChangedAt: new Date() } : {}),
        })
        .where(eq(lead.id, leadRow.id));
      if (autoContacted) {
        await logActivity(tx, ctx, {
          type: "lead_status_changed",
          contactId,
          leadId: leadRow.id,
          payload: { from: "new", to: "contacted", automatic: true },
          // 1 ms después de la interacción que lo provocó, para que el timeline muestre el orden real.
          occurredAt: new Date(occurredAt.getTime() + 1),
        });
        await writeAudit(tx, ctx, {
          action: "lead.status_change",
          entityType: "lead",
          entityId: leadRow.id,
          before: { status: "new" },
          after: { status: "contacted", automatic: true },
        });
        await syncLeadSearch(tx, [leadRow.id]);
      }
    }
    await emitEvent(tx, ctx, {
      type: "interaction.logged",
      aggregateType: leadRow ? "lead" : "contact",
      aggregateId: leadRow?.id ?? contactId ?? "",
      payload: { type: input.type },
    });
  });
}

export interface SearchHit {
  entityType: "contact" | "lead";
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
}

/**
 * Búsqueda global por nombre, teléfono, email, documento o código. Todas las palabras deben
 * aparecer; se filtra por organización y por el alcance de cada tipo en la base.
 */
export async function globalSearch(db: DbOrTx, ctx: RequestContext, rawInput: unknown): Promise<SearchHit[]> {
  const { q } = parseInput(globalSearchSchema, rawInput);
  // "099 123 456" → tokens "099", "123", "456": el cuerpo indexado guarda "099123456", así que
  // cada token coincide por sí solo. Se quitan símbolos ("+598", guiones, puntos de la cédula).
  const tokens = normalizeText(q)
    .split(" ")
    .map((t) => t.replace(/[^a-z0-9@._-]/g, "").replace(/^[.-]+|[.-]+$/g, ""))
    // Cédulas y teléfonos escritos con puntos o guiones ("1.234.567-2") → solo dígitos.
    .map((t) => (/^[\d.-]+$/.test(t) ? t.replace(/\D/g, "") : t))
    .filter((t) => t.length >= 2)
    .slice(0, 6);
  if (tokens.length === 0) return [];
  const terms: SQL[] = tokens.map((t) => {
    const digitsOnly = /^\d+$/.test(t) ? t : null;
    const value =
      digitsOnly && digitsOnly.startsWith("598") && digitsOnly.length > 8 ? digitsOnly.slice(3) : t;
    return sql`${searchDocument.body} like ${`%${value.replace(/[%_]/g, "")}%`}`;
  });

  const cols = {
    ownerUserId: searchDocument.ownerUserId,
    branchId: searchDocument.branchId,
    teamId: searchDocument.teamId,
  };
  const typeScopes: SQL[] = [];
  if (hasPermission(ctx, "contact.read")) {
    typeScopes.push(
      sql`(${searchDocument.entityType} = 'contact' and ${scopeCondition(ctx, "contact.read", cols)})`,
    );
  }
  if (hasPermission(ctx, "lead.read")) {
    typeScopes.push(
      sql`(${searchDocument.entityType} = 'lead' and ${scopeCondition(ctx, "lead.read", cols)})`,
    );
  }
  if (typeScopes.length === 0) return [];

  const allTokens = and(...terms);
  const rows = await db
    .select({
      entityType: searchDocument.entityType,
      id: searchDocument.entityId,
      title: searchDocument.title,
      subtitle: searchDocument.subtitle,
    })
    .from(searchDocument)
    .where(and(eq(searchDocument.organizationId, ctx.organizationId), allTokens, or(...typeScopes)))
    .orderBy(
      // Coincidencia exacta del título, después prefijo, después similitud.
      sql`(lower(unaccent(${searchDocument.title})) = ${normalizeText(q)}) desc`,
      sql`(lower(unaccent(${searchDocument.title})) like ${`${normalizeText(q)}%`}) desc`,
      sql`similarity(lower(unaccent(${searchDocument.title})), ${normalizeText(q)}) desc`,
      asc(searchDocument.title),
    )
    .limit(20);

  return rows.map((r) => ({
    entityType: r.entityType as SearchHit["entityType"],
    id: r.id,
    title: r.title,
    subtitle: r.subtitle,
    href: r.entityType === "lead" ? `/crm/leads/${r.id}` : `/crm/contacts/${r.id}`,
  }));
}

/** Catálogo geográfico (global, no depende de la organización). */
export async function listGeo(db: DbOrTx) {
  const [departments, localities, neighborhoods] = await Promise.all([
    db.select().from(department).where(eq(department.countryCode, "UY")).orderBy(asc(department.name)),
    db.select().from(locality).orderBy(asc(locality.name)),
    db.select().from(neighborhood).orderBy(asc(neighborhood.name)),
  ]);
  return { departments, localities, neighborhoods };
}

export async function geoNames(
  db: DbOrTx,
  ids: { departmentIds?: number[]; localityIds?: number[]; neighborhoodIds?: number[] },
) {
  const [d, l, n] = await Promise.all([
    ids.departmentIds?.length
      ? db.select().from(department).where(inArray(department.id, ids.departmentIds))
      : [],
    ids.localityIds?.length ? db.select().from(locality).where(inArray(locality.id, ids.localityIds)) : [],
    ids.neighborhoodIds?.length
      ? db.select().from(neighborhood).where(inArray(neighborhood.id, ids.neighborhoodIds))
      : [],
  ]);
  return { departments: d, localities: l, neighborhoods: n };
}
