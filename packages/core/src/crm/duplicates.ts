import { and, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import {
  acquisition,
  activity,
  calendarEvent,
  contact,
  contactDate,
  contactRelation,
  propertyOwner,
  contactChannel,
  contactTag,
  duplicateCandidate,
  lead,
  ownerProfile,
  type Db,
  type DbOrTx,
} from "@crm/db";
import { normalizeText } from "@crm/shared";
import { mergeContactsSchema } from "@crm/shared/validation/crm";
import { uuidSchema } from "@crm/shared/validation";
import { writeAudit } from "../audit";
import { hasPermission, requirePermission, type RequestContext } from "../context";
import { ConflictError, NotFoundError, parseInput } from "../errors";
import { emitEvent } from "../events";
import { contactRef, logActivity, syncContactSearch, syncLeadSearch } from "./helpers";

export type DuplicateReason = "document" | "phone" | "email" | "name";

export const DUPLICATE_REASON_LABELS: Record<DuplicateReason, string> = {
  document: "Mismo documento",
  phone: "Mismo teléfono",
  email: "Mismo email",
  name: "Nombre muy parecido",
};

const REASON_SCORE: Record<DuplicateReason, number> = { document: 100, phone: 90, email: 90, name: 55 };

export interface DuplicateMatch {
  contactId: string;
  reasons: DuplicateReason[];
  score: number;
}

/**
 * Busca contactos existentes que probablemente sean la misma persona. Coincidencias exactas de
 * documento, teléfono o email, más similitud de nombre (pg_trgm) sin tildes.
 */
export async function findDuplicateMatches(
  tx: DbOrTx,
  organizationId: string,
  probe: {
    displayName: string;
    documentType: string | null;
    documentNumber: string | null;
    normalizedChannels: string[];
  },
  excludeContactId?: string,
): Promise<DuplicateMatch[]> {
  const found = new Map<string, Set<DuplicateReason>>();
  const add = (id: string, reason: DuplicateReason) => {
    if (id === excludeContactId) return;
    if (!found.has(id)) found.set(id, new Set());
    found.get(id)?.add(reason);
  };
  const alive = and(eq(contact.organizationId, organizationId), isNull(contact.deletedAt));

  if (probe.documentType && probe.documentNumber) {
    const rows = await tx
      .select({ id: contact.id })
      .from(contact)
      .where(
        and(
          alive,
          eq(contact.documentType, probe.documentType as never),
          eq(contact.documentNumber, probe.documentNumber),
        ),
      );
    rows.forEach((r) => add(r.id, "document"));
  }

  if (probe.normalizedChannels.length) {
    const rows = await tx
      .select({ id: contactChannel.contactId, type: contactChannel.type })
      .from(contactChannel)
      .innerJoin(contact, eq(contact.id, contactChannel.contactId))
      .where(and(alive, inArray(contactChannel.normalized, probe.normalizedChannels)));
    rows.forEach((r) => add(r.id, r.type === "email" ? "email" : "phone"));
  }

  const name = normalizeText(probe.displayName);
  if (name.length >= 5) {
    const rows = await tx
      .select({ id: contact.id })
      .from(contact)
      .where(and(alive, sql`similarity(lower(unaccent(${contact.displayName})), ${name}) >= 0.6`))
      .limit(10);
    rows.forEach((r) => add(r.id, "name"));
  }

  return [...found.entries()]
    .map(([contactId, reasons]) => {
      const list = [...reasons];
      const base = Math.max(...list.map((r) => REASON_SCORE[r]));
      return { contactId, reasons: list, score: Math.min(100, base + 5 * (list.length - 1)) };
    })
    .sort((a, b) => b.score - a.score);
}

/** Registra los pares sospechosos para revisión (idempotente). */
export async function recordDuplicateCandidates(
  tx: DbOrTx,
  organizationId: string,
  contactId: string,
  matches: readonly DuplicateMatch[],
): Promise<void> {
  for (const m of matches) {
    const [a, b] = contactId < m.contactId ? [contactId, m.contactId] : [m.contactId, contactId];
    await tx
      .insert(duplicateCandidate)
      .values({ organizationId, contactAId: a, contactBId: b, reasons: m.reasons, score: m.score })
      .onConflictDoUpdate({
        target: [
          duplicateCandidate.organizationId,
          duplicateCandidate.contactAId,
          duplicateCandidate.contactBId,
        ],
        set: { reasons: m.reasons, score: m.score },
        setWhere: sql`${duplicateCandidate.status} = 'pending'`,
      });
  }
}

/**
 * Lo que se le muestra al usuario de un posible duplicado. Si no tiene permiso para ver ese
 * contacto, solo se informa que existe (sin nombre ni datos): evita filtrar información.
 */
export async function describeMatches(tx: DbOrTx, ctx: RequestContext, matches: readonly DuplicateMatch[]) {
  if (matches.length === 0) return [];
  const rows = await tx
    .select()
    .from(contact)
    .where(
      inArray(
        contact.id,
        matches.map((m) => m.contactId),
      ),
    );
  return matches.map((m) => {
    const c = rows.find((r) => r.id === m.contactId);
    const visible = !!c && hasPermission(ctx, "contact.read", contactRef(c));
    return {
      contactId: visible ? m.contactId : null,
      displayName: visible && c ? c.displayName : "Contacto asignado a otro agente",
      reasons: m.reasons,
      score: m.score,
    };
  });
}

export async function listDuplicateCandidates(db: DbOrTx, ctx: RequestContext) {
  requirePermission(ctx, "contact.merge");
  const pairs = await db
    .select()
    .from(duplicateCandidate)
    .where(
      and(
        eq(duplicateCandidate.organizationId, ctx.organizationId),
        eq(duplicateCandidate.status, "pending"),
      ),
    )
    .orderBy(desc(duplicateCandidate.score), desc(duplicateCandidate.createdAt))
    .limit(100);
  const ids = [...new Set(pairs.flatMap((p) => [p.contactAId, p.contactBId]))];
  const contacts = ids.length
    ? await db
        .select()
        .from(contact)
        .where(and(inArray(contact.id, ids), isNull(contact.deletedAt)))
    : [];
  const channels = ids.length
    ? await db.select().from(contactChannel).where(inArray(contactChannel.contactId, ids))
    : [];
  const leadCounts = ids.length
    ? await db
        .select({ contactId: lead.contactId, n: sql<number>`count(*)::int` })
        .from(lead)
        .where(and(inArray(lead.contactId, ids), isNull(lead.deletedAt)))
        .groupBy(lead.contactId)
    : [];

  const view = (id: string) => {
    const c = contacts.find((x) => x.id === id);
    if (!c || !hasPermission(ctx, "contact.merge", contactRef(c))) return null;
    return {
      id: c.id,
      displayName: c.displayName,
      documentType: c.documentType,
      documentNumber: c.documentNumber,
      createdAt: c.createdAt,
      channels: channels
        .filter((ch) => ch.contactId === id)
        .map((ch) => ({ type: ch.type, value: ch.value })),
      leadCount: leadCounts.find((l) => l.contactId === id)?.n ?? 0,
    };
  };

  return pairs.flatMap((p) => {
    const a = view(p.contactAId);
    const b = view(p.contactBId);
    return a && b ? [{ id: p.id, score: p.score, reasons: p.reasons as DuplicateReason[], a, b }] : [];
  });
}

export async function dismissDuplicate(db: Db, ctx: RequestContext, candidateId: string) {
  requirePermission(ctx, "contact.merge");
  const id = parseInput(uuidSchema, candidateId);
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(duplicateCandidate)
      .set({ status: "dismissed", resolvedById: ctx.userId, resolvedAt: new Date() })
      .where(
        and(
          eq(duplicateCandidate.id, id),
          eq(duplicateCandidate.organizationId, ctx.organizationId),
          eq(duplicateCandidate.status, "pending"),
        ),
      )
      .returning();
    if (!row) throw new NotFoundError("Par de duplicados");
    await writeAudit(tx, ctx, {
      action: "contact.duplicate_dismissed",
      entityType: "contact",
      entityId: row.contactAId,
      after: row,
    });
  });
}

/**
 * Fusiona `mergedId` dentro de `survivorId`: mueve canales (sin repetir), leads, timeline,
 * etiquetas y perfil de propietario; completa campos vacíos del sobreviviente y da de baja
 * lógica al fusionado (queda con `merged_into_id` para trazabilidad). Todo en una transacción.
 */
export async function mergeContacts(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(mergeContactsSchema, rawInput);
  requirePermission(ctx, "contact.merge");

  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(contact)
      .where(
        and(
          eq(contact.organizationId, ctx.organizationId),
          inArray(contact.id, [input.survivorId, input.mergedId]),
          isNull(contact.deletedAt),
        ),
      )
      .for("update");
    const survivor = rows.find((r) => r.id === input.survivorId);
    const merged = rows.find((r) => r.id === input.mergedId);
    if (!survivor || !merged) throw new NotFoundError("Contacto");
    requirePermission(ctx, "contact.merge", contactRef(survivor));
    requirePermission(ctx, "contact.merge", contactRef(merged));
    if (survivor.kind !== merged.kind)
      throw new ConflictError("No se puede fusionar una persona con una empresa");

    // 1) Campos vacíos del sobreviviente se completan con los del fusionado.
    const filled = {
      firstName: survivor.firstName ?? merged.firstName,
      lastName: survivor.lastName ?? merged.lastName,
      companyName: survivor.companyName ?? merged.companyName,
      documentType: survivor.documentNumber ? survivor.documentType : merged.documentType,
      documentNumber: survivor.documentNumber ?? merged.documentNumber,
      nationality: survivor.nationality ?? merged.nationality,
      address: survivor.address ?? merged.address,
      departmentId: survivor.departmentId ?? merged.departmentId,
      localityId: survivor.localityId ?? merged.localityId,
      notes: [survivor.notes, merged.notes].filter(Boolean).join("\n\n") || null,
    };

    // 2) El fusionado se da de baja primero para liberar el índice único de documento.
    await tx
      .update(contact)
      .set({ deletedAt: new Date(), mergedIntoId: survivor.id })
      .where(eq(contact.id, merged.id));
    await tx.update(contact).set(filled).where(eq(contact.id, survivor.id));

    // 3) Canales sin duplicar.
    const survivorChannels = await tx
      .select()
      .from(contactChannel)
      .where(eq(contactChannel.contactId, survivor.id));
    const mergedChannels = await tx
      .select()
      .from(contactChannel)
      .where(eq(contactChannel.contactId, merged.id));
    for (const ch of mergedChannels) {
      if (survivorChannels.some((s) => s.normalized === ch.normalized && s.type === ch.type)) {
        await tx.delete(contactChannel).where(eq(contactChannel.id, ch.id));
      } else {
        await tx
          .update(contactChannel)
          .set({ contactId: survivor.id, isPrimary: false })
          .where(eq(contactChannel.id, ch.id));
      }
    }

    // 4) Leads, timeline y etiquetas.
    const movedLeads = await tx
      .update(lead)
      .set({ contactId: survivor.id })
      .where(eq(lead.contactId, merged.id))
      .returning({ id: lead.id });
    await tx.update(activity).set({ contactId: survivor.id }).where(eq(activity.contactId, merged.id));
    await tx.execute(sql`
      insert into contact_tag (contact_id, tag_id)
      select ${survivor.id}, tag_id from contact_tag where contact_id = ${merged.id}
      on conflict do nothing`);
    await tx.delete(contactTag).where(eq(contactTag.contactId, merged.id));

    // 4b) Agenda, fechas importantes, vínculos, captaciones y copropiedad.
    await tx
      .update(calendarEvent)
      .set({ contactId: survivor.id })
      .where(eq(calendarEvent.contactId, merged.id));
    await tx.update(contactDate).set({ contactId: survivor.id }).where(eq(contactDate.contactId, merged.id));
    await tx.execute(sql`
      insert into contact_relation (id, organization_id, contact_id, related_contact_id, type, note, created_by_id, created_at)
      select gen_random_uuid(), organization_id,
             case when contact_id = ${merged.id} then ${survivor.id}::uuid else contact_id end,
             case when related_contact_id = ${merged.id} then ${survivor.id}::uuid else related_contact_id end,
             type, note, created_by_id, created_at
      from contact_relation
      where (contact_id = ${merged.id} or related_contact_id = ${merged.id})
        and not (contact_id in (${merged.id}, ${survivor.id}) and related_contact_id in (${merged.id}, ${survivor.id}))
      on conflict do nothing`);
    await tx
      .delete(contactRelation)
      .where(or(eq(contactRelation.contactId, merged.id), eq(contactRelation.relatedContactId, merged.id)));
    await tx
      .update(acquisition)
      .set({ ownerContactId: survivor.id })
      .where(eq(acquisition.ownerContactId, merged.id));
    // Si ambos eran copropietarios de la misma propiedad, se suman las participaciones.
    await tx.execute(sql`
      update property_owner s set share_basis_points = s.share_basis_points + m.share_basis_points
      from property_owner m
      where s.contact_id = ${survivor.id} and m.contact_id = ${merged.id} and s.property_id = m.property_id`);
    await tx.execute(sql`
      delete from property_owner m using property_owner s
      where m.contact_id = ${merged.id} and s.contact_id = ${survivor.id} and s.property_id = m.property_id`);
    await tx
      .update(propertyOwner)
      .set({ contactId: survivor.id })
      .where(eq(propertyOwner.contactId, merged.id));

    // 5) Perfil de propietario: se conserva el del sobreviviente si existe.
    const [survivorOwner] = await tx
      .select()
      .from(ownerProfile)
      .where(eq(ownerProfile.contactId, survivor.id));
    const [mergedOwner] = await tx.select().from(ownerProfile).where(eq(ownerProfile.contactId, merged.id));
    if (mergedOwner && !survivorOwner) {
      await tx
        .update(ownerProfile)
        .set({ contactId: survivor.id })
        .where(eq(ownerProfile.contactId, merged.id));
    } else if (mergedOwner) {
      await tx.delete(ownerProfile).where(eq(ownerProfile.contactId, merged.id));
    }

    // 6) Pares de duplicados: el par resuelto queda "merged"; los demás del fusionado se descartan.
    const [a, b] = survivor.id < merged.id ? [survivor.id, merged.id] : [merged.id, survivor.id];
    await tx
      .update(duplicateCandidate)
      .set({ status: "merged", resolvedById: ctx.userId, resolvedAt: new Date() })
      .where(
        and(
          eq(duplicateCandidate.organizationId, ctx.organizationId),
          eq(duplicateCandidate.contactAId, a),
          eq(duplicateCandidate.contactBId, b),
        ),
      );
    await tx
      .update(duplicateCandidate)
      .set({ status: "dismissed", resolvedById: ctx.userId, resolvedAt: new Date() })
      .where(
        and(
          eq(duplicateCandidate.organizationId, ctx.organizationId),
          eq(duplicateCandidate.status, "pending"),
          or(eq(duplicateCandidate.contactAId, merged.id), eq(duplicateCandidate.contactBId, merged.id)),
          ne(duplicateCandidate.contactAId, duplicateCandidate.contactBId),
        ),
      );

    await syncContactSearch(tx, survivor.id);
    await syncContactSearch(tx, merged.id);
    await syncLeadSearch(
      tx,
      movedLeads.map((l) => l.id),
    );

    await logActivity(tx, ctx, {
      type: "contact_merged",
      contactId: survivor.id,
      body: `Se fusionó con ${merged.displayName}`,
      payload: { mergedId: merged.id, mergedName: merged.displayName, movedLeads: movedLeads.length },
    });
    await writeAudit(tx, ctx, {
      action: "contact.merge",
      entityType: "contact",
      entityId: survivor.id,
      before: { survivor, merged },
      after: { survivorId: survivor.id, mergedId: merged.id, movedLeads: movedLeads.map((l) => l.id) },
    });
    await emitEvent(tx, ctx, {
      type: "contact.merged",
      aggregateType: "contact",
      aggregateId: survivor.id,
      payload: { mergedId: merged.id },
    });
    return { survivorId: survivor.id };
  });
}
