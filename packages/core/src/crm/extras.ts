import { aliasedTable, and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { contact, contactDate, contactRelation, type Db, type DbOrTx } from "@crm/db";
import { RELATION_TYPE_LABELS } from "@crm/shared";
import { contactDateSchema, contactRelationSchema } from "@crm/shared/validation/crm";
import { uuidSchema } from "@crm/shared/validation";
import { scopeCondition } from "../access-filter";
import { writeAudit } from "../audit";
import { hasPermission, requirePermission, type RequestContext } from "../context";
import { ConflictError, NotFoundError, isUniqueViolation, parseInput } from "../errors";
import { contactRef, logActivity } from "./helpers";

async function loadContact(tx: DbOrTx, ctx: RequestContext, id: string) {
  const [c] = await tx
    .select()
    .from(contact)
    .where(
      and(eq(contact.id, id), eq(contact.organizationId, ctx.organizationId), isNull(contact.deletedAt)),
    );
  if (!c || !hasPermission(ctx, "contact.read", contactRef(c))) throw new NotFoundError("Contacto");
  return c;
}

// ---------------------------------------------------------------------------------------------
// Fechas importantes
// ---------------------------------------------------------------------------------------------

export async function addContactDate(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(contactDateSchema, rawInput);
  return db.transaction(async (tx) => {
    const c = await loadContact(tx, ctx, input.contactId);
    requirePermission(ctx, "contact.update", contactRef(c));
    const [row] = await tx
      .insert(contactDate)
      .values({ organizationId: ctx.organizationId, ...input, createdById: ctx.userId })
      .returning();
    if (!row) throw new Error("No se pudo guardar la fecha");
    await writeAudit(tx, ctx, {
      action: "contact.date_add",
      entityType: "contact",
      entityId: c.id,
      after: row,
    });
    return row;
  });
}

export async function deleteContactDate(db: Db, ctx: RequestContext, dateId: string) {
  const id = parseInput(uuidSchema, dateId);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(contactDate)
      .where(and(eq(contactDate.id, id), eq(contactDate.organizationId, ctx.organizationId)));
    if (!row) throw new NotFoundError("Fecha");
    const c = await loadContact(tx, ctx, row.contactId);
    requirePermission(ctx, "contact.update", contactRef(c));
    await tx.delete(contactDate).where(eq(contactDate.id, id));
    await writeAudit(tx, ctx, {
      action: "contact.date_remove",
      entityType: "contact",
      entityId: c.id,
      before: row,
    });
  });
}

/** Días hasta la próxima ocurrencia (las anuales se proyectan al año que corresponde). */
export function nextOccurrence(
  date: string,
  yearly: boolean,
  today: string,
): { date: string; days: number } | null {
  const toUtc = (s: string) => Date.parse(`${s}T00:00:00Z`);
  const t = toUtc(today);
  if (!yearly) {
    const d = Math.round((toUtc(date) - t) / 86_400_000);
    return d >= 0 ? { date, days: d } : null;
  }
  const md = date.slice(5);
  const year = Number(today.slice(0, 4));
  for (const y of [year, year + 1]) {
    // 29/2 en años no bisiestos se celebra el 28/2.
    let candidate = `${y}-${md}`;
    if (md === "02-29" && Number.isNaN(Date.parse(`${candidate}T00:00:00Z`))) candidate = `${y}-02-28`;
    if (new Date(`${candidate}T00:00:00Z`).toISOString().slice(0, 10) !== candidate) candidate = `${y}-02-28`;
    const d = Math.round((toUtc(candidate) - t) / 86_400_000);
    if (d >= 0) return { date: candidate, days: d };
  }
  return null;
}

export async function listContactDates(db: DbOrTx, ctx: RequestContext, contactId: string, today: string) {
  const c = await loadContact(db, ctx, parseInput(uuidSchema, contactId));
  const rows = await db
    .select()
    .from(contactDate)
    .where(and(eq(contactDate.organizationId, ctx.organizationId), eq(contactDate.contactId, c.id)))
    .orderBy(asc(contactDate.date));
  return rows
    .map((r) => ({ ...r, next: nextOccurrence(r.date, r.yearly, today) }))
    .sort((a, b) => (a.next?.days ?? 1e9) - (b.next?.days ?? 1e9));
}

/** Fechas de los próximos días de los contactos que el usuario puede ver (dashboard). */
export async function upcomingContactDates(db: DbOrTx, ctx: RequestContext, today: string, days = 14) {
  if (!hasPermission(ctx, "contact.read")) return [];
  const rows = await db
    .select({ d: contactDate, contactName: contact.displayName })
    .from(contactDate)
    .innerJoin(contact, eq(contact.id, contactDate.contactId))
    .where(
      and(
        eq(contactDate.organizationId, ctx.organizationId),
        isNull(contact.deletedAt),
        scopeCondition(ctx, "contact.read", {
          ownerUserId: contact.assignedUserId,
          branchId: contact.branchId,
          teamId: contact.teamId,
        }),
      ),
    )
    .limit(2000);
  return rows
    .map((r) => ({ ...r.d, contactName: r.contactName, next: nextOccurrence(r.d.date, r.d.yearly, today) }))
    .filter((r) => r.next && r.next.days <= days)
    .sort((a, b) => (a.next?.days ?? 0) - (b.next?.days ?? 0))
    .slice(0, 10);
}

// ---------------------------------------------------------------------------------------------
// Vínculos
// ---------------------------------------------------------------------------------------------

export async function addContactRelation(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(contactRelationSchema, rawInput);
  return db.transaction(async (tx) => {
    const c = await loadContact(tx, ctx, input.contactId);
    requirePermission(ctx, "contact.update", contactRef(c));
    const other = await loadContact(tx, ctx, input.relatedContactId);
    const [existing] = await tx
      .select({ id: contactRelation.id })
      .from(contactRelation)
      .where(
        and(
          eq(contactRelation.organizationId, ctx.organizationId),
          eq(contactRelation.type, input.type),
          or(
            and(eq(contactRelation.contactId, c.id), eq(contactRelation.relatedContactId, other.id)),
            and(eq(contactRelation.contactId, other.id), eq(contactRelation.relatedContactId, c.id)),
          ),
        ),
      );
    if (existing) throw new ConflictError("Ese vínculo ya existe");
    try {
      const [row] = await tx
        .insert(contactRelation)
        .values({
          organizationId: ctx.organizationId,
          contactId: c.id,
          relatedContactId: other.id,
          type: input.type,
          note: input.note,
          createdById: ctx.userId,
        })
        .returning();
      if (!row) throw new Error("No se pudo vincular");
      await logActivity(tx, ctx, {
        type: "contact_updated",
        contactId: c.id,
        body: `Vinculado con ${other.displayName} (${RELATION_TYPE_LABELS[input.type]})`,
        payload: { relationId: row.id, relatedContactId: other.id, type: input.type },
      });
      await writeAudit(tx, ctx, {
        action: "contact.relation_add",
        entityType: "contact",
        entityId: c.id,
        after: row,
      });
      return row;
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictError("Ese vínculo ya existe");
      throw error;
    }
  });
}

export async function removeContactRelation(db: Db, ctx: RequestContext, relationId: string) {
  const id = parseInput(uuidSchema, relationId);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(contactRelation)
      .where(and(eq(contactRelation.id, id), eq(contactRelation.organizationId, ctx.organizationId)));
    if (!row) throw new NotFoundError("Vínculo");
    // Puede quitarlo quien puede editar cualquiera de los dos lados.
    const [a, b] = await Promise.all([
      loadContact(tx, ctx, row.contactId).catch(() => null),
      loadContact(tx, ctx, row.relatedContactId).catch(() => null),
    ]);
    const allowed =
      (a && hasPermission(ctx, "contact.update", contactRef(a))) ||
      (b && hasPermission(ctx, "contact.update", contactRef(b)));
    if (!allowed) throw new NotFoundError("Vínculo");
    await tx.delete(contactRelation).where(eq(contactRelation.id, id));
    await writeAudit(tx, ctx, {
      action: "contact.relation_remove",
      entityType: "contact",
      entityId: row.contactId,
      before: row,
    });
  });
}

const other = aliasedTable(contact, "other_contact");

/**
 * Vínculos de un contacto desde ambos lados. El nombre del otro contacto solo se muestra si
 * quien mira puede verlo; si no, aparece como "Contacto (restringido)".
 */
export async function listContactRelations(db: DbOrTx, ctx: RequestContext, contactId: string) {
  const c = await loadContact(db, ctx, parseInput(uuidSchema, contactId));
  const rows = await db
    .select({ r: contactRelation, o: other })
    .from(contactRelation)
    .innerJoin(
      other,
      sql`${other.id} = case when ${contactRelation.contactId} = ${c.id} then ${contactRelation.relatedContactId} else ${contactRelation.contactId} end`,
    )
    .where(
      and(
        eq(contactRelation.organizationId, ctx.organizationId),
        or(eq(contactRelation.contactId, c.id), eq(contactRelation.relatedContactId, c.id)),
        isNull(other.deletedAt),
      ),
    )
    .orderBy(asc(contactRelation.createdAt));
  const canEditSelf = hasPermission(ctx, "contact.update", contactRef(c));
  return rows.map(({ r, o }) => {
    const visible = hasPermission(ctx, "contact.read", contactRef(o));
    return {
      id: r.id,
      type: r.type,
      note: r.note,
      otherId: visible ? o.id : null,
      otherName: visible ? o.displayName : "Contacto (restringido)",
      canRemove: canEditSelf,
    };
  });
}
