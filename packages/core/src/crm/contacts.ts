import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  isNull,
  not,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  branch,
  contact,
  contactChannel,
  contactTag,
  duplicateCandidate,
  lead,
  ownerProfile,
  tag,
  user,
  type Db,
  type DbOrTx,
} from "@crm/db";
import {
  normalizeDocument,
  normalizeEmail,
  normalizePhone,
  normalizeText,
  OPEN_LEAD_STATUSES,
  type LeadOperation,
  type LeadSource,
  type ChannelInput,
} from "@crm/shared";
import { contactInputSchema, contactListSchema, updateContactSchema } from "@crm/shared/validation/crm";
import { uuidSchema } from "@crm/shared/validation";
import { scopeCondition } from "../access-filter";
import { writeAudit } from "../audit";
import { hasPermission, requirePermission, type RequestContext } from "../context";
import { ConflictError, ForbiddenError, NotFoundError, isUniqueViolation, parseInput } from "../errors";
import { emitEvent } from "../events";
import { describeMatches, findDuplicateMatches, recordDuplicateCandidates } from "./duplicates";
import {
  buildDisplayName,
  contactRef,
  logActivity,
  resolveAssignment,
  syncContactSearch,
  syncLeadSearch,
} from "./helpers";
import { maskedOwnerProfile } from "./owners";

type ContactInputParsed = ReturnType<typeof contactInputSchema.parse>;

function normalizeChannels(channels: readonly ChannelInput[]) {
  const seen = new Set<string>();
  const out: {
    type: ChannelInput["type"];
    value: string;
    normalized: string;
    label: string | null;
    isPrimary: boolean;
  }[] = [];
  for (const ch of channels) {
    const normalized =
      ch.type === "email" ? normalizeEmail(ch.value) : (normalizePhone(ch.value) ?? ch.value);
    const key = `${ch.type}:${normalized}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type: ch.type, value: ch.value.trim(), normalized, label: ch.label, isPrimary: ch.isPrimary });
  }
  // Un principal por tipo: si no se marcó ninguno, el primero de cada tipo.
  for (const type of ["phone", "whatsapp", "email"] as const) {
    const ofType = out.filter((c) => c.type === type);
    if (ofType.length && !ofType.some((c) => c.isPrimary)) {
      const first = ofType[0];
      if (first) first.isPrimary = true;
    }
    ofType
      .filter((c) => c.isPrimary)
      .slice(1)
      .forEach((c) => (c.isPrimary = false));
  }
  return out;
}

async function replaceTags(tx: DbOrTx, organizationId: string, contactId: string, names: readonly string[]) {
  await tx.delete(contactTag).where(eq(contactTag.contactId, contactId));
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  for (const name of unique) {
    await tx.insert(tag).values({ organizationId, name }).onConflictDoNothing();
  }
  if (!unique.length) return;
  const rows = await tx
    .select({ id: tag.id })
    .from(tag)
    .where(and(eq(tag.organizationId, organizationId), inArray(tag.name, unique)));
  await tx.insert(contactTag).values(rows.map((r) => ({ contactId, tagId: r.id })));
}

/** Quién queda como responsable: uno mismo, salvo que tenga permiso para asignar a otros. */
async function resolveResponsible(tx: DbOrTx, ctx: RequestContext, requested: string | null) {
  const assignedUserId = requested ?? ctx.userId;
  if (assignedUserId !== ctx.userId && !hasPermission(ctx, "lead.assign")) {
    throw new ForbiddenError("No podés asignar contactos a otros usuarios");
  }
  const { branchId, teamId } = await resolveAssignment(tx, ctx.organizationId, assignedUserId);
  return { assignedUserId, branchId, teamId };
}

function contactValues(input: ContactInputParsed) {
  return {
    kind: input.kind,
    firstName: input.kind === "person" ? input.firstName : null,
    lastName: input.kind === "person" ? input.lastName : null,
    companyName: input.companyName,
    displayName: buildDisplayName(input),
    documentType: input.documentNumber ? input.documentType : null,
    documentNumber:
      input.documentNumber && input.documentType
        ? normalizeDocument(input.documentType, input.documentNumber)
        : null,
    nationality: input.nationality,
    address: input.address,
    departmentId: input.departmentId,
    localityId: input.localityId,
    notes: input.notes,
  };
}

async function assertDocumentFree(
  tx: DbOrTx,
  ctx: RequestContext,
  values: ReturnType<typeof contactValues>,
  excludeId?: string,
) {
  if (!values.documentNumber || !values.documentType) return;
  const [existing] = await tx
    .select()
    .from(contact)
    .where(
      and(
        eq(contact.organizationId, ctx.organizationId),
        eq(contact.documentType, values.documentType),
        eq(contact.documentNumber, values.documentNumber),
        isNull(contact.deletedAt),
      ),
    );
  if (existing && existing.id !== excludeId) {
    const visible = hasPermission(ctx, "contact.read", contactRef(existing));
    throw new ConflictError(
      visible
        ? `Ya existe un contacto con ese documento: ${existing.displayName}`
        : "Ya existe un contacto con ese documento (asignado a otro agente)",
    );
  }
}

/** Uso interno (también desde createLead): crea el contacto dentro de una transacción existente. */
export async function insertContact(tx: DbOrTx, ctx: RequestContext, input: ContactInputParsed) {
  requirePermission(ctx, "contact.create");
  const responsible = await resolveResponsible(tx, ctx, input.assignedUserId);
  const values = contactValues(input);
  await assertDocumentFree(tx, ctx, values);
  const channels = normalizeChannels(input.channels);

  const matches = await findDuplicateMatches(tx, ctx.organizationId, {
    displayName: values.displayName,
    documentType: values.documentType,
    documentNumber: values.documentNumber,
    normalizedChannels: channels.map((c) => c.normalized),
  });

  let row: typeof contact.$inferSelect | undefined;
  try {
    [row] = await tx
      .insert(contact)
      .values({ organizationId: ctx.organizationId, ...values, ...responsible, createdById: ctx.userId })
      .returning();
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError("Ya existe un contacto con ese documento");
    throw error;
  }
  if (!row) throw new Error("No se pudo crear el contacto");
  if (channels.length) {
    await tx
      .insert(contactChannel)
      .values(channels.map((c) => ({ ...c, organizationId: ctx.organizationId, contactId: row.id })));
  }
  await replaceTags(tx, ctx.organizationId, row.id, input.tags);
  await recordDuplicateCandidates(tx, ctx.organizationId, row.id, matches);
  await syncContactSearch(tx, row.id);
  await logActivity(tx, ctx, { type: "contact_created", contactId: row.id });
  await writeAudit(tx, ctx, {
    action: "contact.create",
    entityType: "contact",
    entityId: row.id,
    after: { ...row, channels, tags: input.tags },
  });
  await emitEvent(tx, ctx, { type: "contact.created", aggregateType: "contact", aggregateId: row.id });
  return { contact: row, duplicates: await describeMatches(tx, ctx, matches) };
}

export async function createContact(db: Db, ctx: RequestContext, rawInput: unknown) {
  requirePermission(ctx, "contact.create");
  const input = parseInput(contactInputSchema, rawInput);
  return db.transaction((tx) => insertContact(tx, ctx, input));
}

async function loadContactForWrite(tx: DbOrTx, ctx: RequestContext, id: string) {
  const [row] = await tx
    .select()
    .from(contact)
    .where(and(eq(contact.id, id), eq(contact.organizationId, ctx.organizationId), isNull(contact.deletedAt)))
    .for("update");
  if (!row) throw new NotFoundError("Contacto");
  return row;
}

export async function updateContact(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(updateContactSchema, rawInput);
  return db.transaction(async (tx) => {
    const before = await loadContactForWrite(tx, ctx, input.id);
    requirePermission(ctx, "contact.update", contactRef(before));

    const reassigned = (input.assignedUserId ?? before.assignedUserId) !== before.assignedUserId;
    let responsible = {
      assignedUserId: before.assignedUserId,
      branchId: before.branchId,
      teamId: before.teamId,
    };
    if (reassigned && input.assignedUserId) {
      requirePermission(ctx, "lead.assign");
      responsible = {
        assignedUserId: input.assignedUserId,
        ...(await resolveAssignment(tx, ctx.organizationId, input.assignedUserId)),
      };
    }

    const values = contactValues(input);
    await assertDocumentFree(tx, ctx, values, before.id);
    const beforeChannels = await tx
      .select()
      .from(contactChannel)
      .where(eq(contactChannel.contactId, before.id));
    const channels = normalizeChannels(input.channels);

    const [after] = await tx
      .update(contact)
      .set({ ...values, ...responsible })
      .where(eq(contact.id, before.id))
      .returning();
    await tx.delete(contactChannel).where(eq(contactChannel.contactId, before.id));
    if (channels.length) {
      await tx
        .insert(contactChannel)
        .values(channels.map((c) => ({ ...c, organizationId: ctx.organizationId, contactId: before.id })));
    }
    await replaceTags(tx, ctx.organizationId, before.id, input.tags);

    const matches = await findDuplicateMatches(
      tx,
      ctx.organizationId,
      {
        displayName: values.displayName,
        documentType: values.documentType,
        documentNumber: values.documentNumber,
        normalizedChannels: channels.map((c) => c.normalized),
      },
      before.id,
    );
    await recordDuplicateCandidates(tx, ctx.organizationId, before.id, matches);
    await syncContactSearch(tx, before.id);
    const leads = await tx.select({ id: lead.id }).from(lead).where(eq(lead.contactId, before.id));
    await syncLeadSearch(
      tx,
      leads.map((l) => l.id),
    );

    await logActivity(tx, ctx, { type: "contact_updated", contactId: before.id });
    await writeAudit(tx, ctx, {
      action: "contact.update",
      entityType: "contact",
      entityId: before.id,
      before: { ...before, channels: beforeChannels.map((c) => c.value) },
      after: { ...after, channels: channels.map((c) => c.value) },
    });
    if (reassigned) {
      await writeAudit(tx, ctx, {
        action: "contact.assignment_change",
        entityType: "contact",
        entityId: before.id,
        before: { assignedUserId: before.assignedUserId },
        after: { assignedUserId: responsible.assignedUserId },
      });
    }
    await emitEvent(tx, ctx, { type: "contact.updated", aggregateType: "contact", aggregateId: before.id });
    return { contact: after, duplicates: await describeMatches(tx, ctx, matches) };
  });
}

export async function deleteContact(db: Db, ctx: RequestContext, contactId: string) {
  const id = parseInput(uuidSchema, contactId);
  return db.transaction(async (tx) => {
    const before = await loadContactForWrite(tx, ctx, id);
    requirePermission(ctx, "contact.delete", contactRef(before));
    const [open] = await tx
      .select({ n: count() })
      .from(lead)
      .where(
        and(eq(lead.contactId, id), isNull(lead.deletedAt), inArray(lead.status, [...OPEN_LEAD_STATUSES])),
      );
    if ((open?.n ?? 0) > 0)
      throw new ConflictError("El contacto tiene leads abiertos. Cerralos o marcalos como perdidos primero.");
    await tx.update(contact).set({ deletedAt: new Date() }).where(eq(contact.id, id));
    await syncContactSearch(tx, id);
    await writeAudit(tx, ctx, { action: "contact.delete", entityType: "contact", entityId: id, before });
    await emitEvent(tx, ctx, { type: "contact.deleted", aggregateType: "contact", aggregateId: id });
  });
}

/** Estado comercial de un contacto según sus leads (vista simple tipo tablero). */
function clientStateOf(
  stats: { open: number; won: number; total: number } | undefined,
): "active" | "closed" | "discarded" | null {
  if (!stats || stats.total === 0) return null;
  if (stats.open > 0) return "active";
  if (stats.won > 0) return "closed";
  return "discarded";
}

export async function listContacts(db: DbOrTx, ctx: RequestContext, rawQuery: unknown) {
  const q = parseInput(contactListSchema, rawQuery);
  const readCode = q.role === "owner" ? "owner.read" : "contact.read";
  requirePermission(ctx, readCode);

  const conditions: (SQL | undefined)[] = [
    eq(contact.organizationId, ctx.organizationId),
    isNull(contact.deletedAt),
    scopeCondition(ctx, readCode, {
      ownerUserId: contact.assignedUserId,
      branchId: contact.branchId,
      teamId: contact.teamId,
    }),
  ];
  if (q.q) {
    const term = `%${normalizeText(q.q)}%`;
    const digits = q.q.replace(/\D/g, "");
    conditions.push(
      or(
        sql`lower(unaccent(${contact.displayName})) like ${term}`,
        exists(
          db
            .select({ one: sql`1` })
            .from(contactChannel)
            .where(
              and(
                eq(contactChannel.contactId, contact.id),
                digits.length >= 4
                  ? or(
                      ilike(contactChannel.normalized, `%${q.q.trim().toLowerCase()}%`),
                      sql`${contactChannel.normalized} like ${`%${digits.replace(/^0/, "")}%`}`,
                    )
                  : ilike(contactChannel.normalized, `%${q.q.trim().toLowerCase()}%`),
              ),
            ),
        ),
        digits.length >= 4 ? sql`${contact.documentNumber} like ${`%${digits}%`}` : undefined,
      ),
    );
  }
  if (q.role === "owner") {
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(ownerProfile)
          .where(eq(ownerProfile.contactId, contact.id)),
      ),
    );
  }
  if (q.role === "client") {
    const leadOf = (extra?: SQL) =>
      exists(
        db
          .select({ one: sql`1` })
          .from(lead)
          .where(and(eq(lead.contactId, contact.id), isNull(lead.deletedAt), extra)),
      );
    const open = leadOf(inArray(lead.status, [...OPEN_LEAD_STATUSES]));
    const won = leadOf(eq(lead.status, "won"));
    if (q.state === "active") conditions.push(open);
    else if (q.state === "closed") conditions.push(and(won, not(open)));
    else if (q.state === "discarded")
      conditions.push(and(leadOf(eq(lead.status, "lost")), not(open), not(won)));
    else conditions.push(leadOf());
    if (q.source) conditions.push(leadOf(eq(lead.source, q.source)));
    if (q.operation) conditions.push(leadOf(eq(lead.operation, q.operation)));
  }
  if (q.tag) {
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(contactTag)
          .innerJoin(tag, eq(tag.id, contactTag.tagId))
          .where(and(eq(contactTag.contactId, contact.id), eq(tag.name, q.tag))),
      ),
    );
  }
  if (q.assignedUserId) conditions.push(eq(contact.assignedUserId, q.assignedUserId));
  const where = and(...conditions);

  const [rows, totals] = await Promise.all([
    db
      .select({
        id: contact.id,
        kind: contact.kind,
        displayName: contact.displayName,
        documentType: contact.documentType,
        documentNumber: contact.documentNumber,
        createdAt: contact.createdAt,
        assignedName: user.name,
        branchName: branch.name,
      })
      .from(contact)
      .leftJoin(user, eq(user.id, contact.assignedUserId))
      .leftJoin(branch, eq(branch.id, contact.branchId))
      .where(where)
      .orderBy(
        ...(q.role === "client"
          ? [desc(contact.createdAt), desc(contact.id)]
          : [asc(contact.displayName), asc(contact.id)]),
      )
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ total: count() }).from(contact).where(where),
  ]);

  const ids = rows.map((r) => r.id);
  const [channels, tags, leadStats, owners] = ids.length
    ? await Promise.all([
        db
          .select({
            contactId: contactChannel.contactId,
            type: contactChannel.type,
            value: contactChannel.value,
            isPrimary: contactChannel.isPrimary,
          })
          .from(contactChannel)
          .where(inArray(contactChannel.contactId, ids)),
        db
          .select({ contactId: contactTag.contactId, name: tag.name })
          .from(contactTag)
          .innerJoin(tag, eq(tag.id, contactTag.tagId))
          .where(inArray(contactTag.contactId, ids)),
        db
          .select({
            contactId: lead.contactId,
            open: sql<number>`count(*) filter (where ${lead.status} in ('new','contacted','qualified','visit','offer','reservation'))::int`,
            won: sql<number>`count(*) filter (where ${lead.status} = 'won')::int`,
            total: sql<number>`count(*)::int`,
            lastSource: sql<LeadSource | null>`(array_agg(${lead.source} order by ${lead.createdAt} desc))[1]`,
            lastOperation: sql<LeadOperation | null>`(array_agg(${lead.operation} order by ${lead.createdAt} desc))[1]`,
          })
          .from(lead)
          .where(and(inArray(lead.contactId, ids), isNull(lead.deletedAt)))
          .groupBy(lead.contactId),
        db
          .select({ contactId: ownerProfile.contactId })
          .from(ownerProfile)
          .where(inArray(ownerProfile.contactId, ids)),
      ])
    : [[], [], [], []];

  return {
    items: rows.map((r) => {
      const own = channels.filter((c) => c.contactId === r.id);
      const phone = own.find((c) => c.type !== "email" && c.isPrimary) ?? own.find((c) => c.type !== "email");
      const email = own.find((c) => c.type === "email" && c.isPrimary) ?? own.find((c) => c.type === "email");
      return {
        ...r,
        documentNumber: hasPermission(ctx, "contact.identity.read") ? r.documentNumber : null,
        phone: phone?.value ?? null,
        email: email?.value ?? null,
        tags: tags.filter((t) => t.contactId === r.id).map((t) => t.name),
        openLeads: leadStats.find((l) => l.contactId === r.id)?.open ?? 0,
        clientState: clientStateOf(leadStats.find((l) => l.contactId === r.id)),
        lastSource: leadStats.find((l) => l.contactId === r.id)?.lastSource ?? null,
        lastOperation: leadStats.find((l) => l.contactId === r.id)?.lastOperation ?? null,
        whatsapp:
          own.some((c) => c.type === "whatsapp") ||
          (phone?.type === "phone" && (phone.value ?? "").replace(/\D/g, "").length >= 8),
        isOwner: owners.some((o) => o.contactId === r.id),
      };
    }),
    total: totals[0]?.total ?? 0,
    page: q.page,
    pageSize: q.pageSize,
  };
}

/** Ficha 360°: datos, canales, etiquetas, leads, perfil de propietario y duplicados pendientes. */
export async function getContact(db: DbOrTx, ctx: RequestContext, contactId: string) {
  const id = parseInput(uuidSchema, contactId);
  const [row] = await db
    .select({ contact, assignedName: user.name, branchName: branch.name })
    .from(contact)
    .leftJoin(user, eq(user.id, contact.assignedUserId))
    .leftJoin(branch, eq(branch.id, contact.branchId))
    .where(and(eq(contact.id, id), eq(contact.organizationId, ctx.organizationId)));
  if (!row) throw new NotFoundError("Contacto");
  const c = row.contact;
  const ref = contactRef(c);
  const canRead = hasPermission(ctx, "contact.read", ref) || hasPermission(ctx, "owner.read", ref);
  if (!canRead) throw new NotFoundError("Contacto");
  if (c.deletedAt) {
    if (c.mergedIntoId) return { redirectTo: c.mergedIntoId } as const;
    throw new NotFoundError("Contacto");
  }

  const [channels, tags, leads, owner, duplicates] = await Promise.all([
    db
      .select()
      .from(contactChannel)
      .where(eq(contactChannel.contactId, id))
      .orderBy(desc(contactChannel.isPrimary), asc(contactChannel.createdAt)),
    db
      .select({ name: tag.name })
      .from(contactTag)
      .innerJoin(tag, eq(tag.id, contactTag.tagId))
      .where(eq(contactTag.contactId, id)),
    db
      .select({
        id: lead.id,
        code: lead.code,
        status: lead.status,
        operation: lead.operation,
        source: lead.source,
        createdAt: lead.createdAt,
        assignedUserId: lead.assignedUserId,
        branchId: lead.branchId,
        teamId: lead.teamId,
        assignedName: user.name,
      })
      .from(lead)
      .leftJoin(user, eq(user.id, lead.assignedUserId))
      .where(and(eq(lead.contactId, id), isNull(lead.deletedAt)))
      .orderBy(desc(lead.createdAt)),
    db.select().from(ownerProfile).where(eq(ownerProfile.contactId, id)),
    db
      .select({
        id: duplicateCandidate.id,
        a: duplicateCandidate.contactAId,
        b: duplicateCandidate.contactBId,
        reasons: duplicateCandidate.reasons,
        score: duplicateCandidate.score,
      })
      .from(duplicateCandidate)
      .where(
        and(
          eq(duplicateCandidate.organizationId, ctx.organizationId),
          eq(duplicateCandidate.status, "pending"),
          or(eq(duplicateCandidate.contactAId, id), eq(duplicateCandidate.contactBId, id)),
        ),
      ),
  ]);

  const otherIds = duplicates.map((d) => (d.a === id ? d.b : d.a));
  const others = otherIds.length
    ? await db
        .select()
        .from(contact)
        .where(and(inArray(contact.id, otherIds), isNull(contact.deletedAt)))
    : [];

  return {
    contact: {
      ...c,
      documentNumber: hasPermission(ctx, "contact.identity.read", ref) ? c.documentNumber : null,
      documentHidden: !!c.documentNumber && !hasPermission(ctx, "contact.identity.read", ref),
      assignedName: row.assignedName,
      branchName: row.branchName,
    },
    channels,
    tags: tags.map((t) => t.name),
    leads: leads.filter((l) =>
      hasPermission(ctx, "lead.read", {
        organizationId: ctx.organizationId,
        ownerUserId: l.assignedUserId,
        branchId: l.branchId,
        teamId: l.teamId,
      }),
    ),
    hiddenLeadCount: leads.filter(
      (l) =>
        !hasPermission(ctx, "lead.read", {
          organizationId: ctx.organizationId,
          ownerUserId: l.assignedUserId,
          branchId: l.branchId,
          teamId: l.teamId,
        }),
    ).length,
    owner: owner[0] && hasPermission(ctx, "owner.read", ref) ? maskedOwnerProfile(ctx, ref, owner[0]) : null,
    duplicates: duplicates.flatMap((d) => {
      const otherId = d.a === id ? d.b : d.a;
      const other = others.find((o) => o.id === otherId);
      if (!other) return [];
      const visible = hasPermission(ctx, "contact.read", contactRef(other));
      return [
        {
          candidateId: d.id,
          contactId: visible ? other.id : null,
          displayName: visible ? other.displayName : "Contacto de otro agente",
          reasons: d.reasons,
          score: d.score,
        },
      ];
    }),
    permissions: {
      update: hasPermission(ctx, "contact.update", ref),
      delete: hasPermission(ctx, "contact.delete", ref),
      merge: hasPermission(ctx, "contact.merge", ref),
      assign: hasPermission(ctx, "lead.assign"),
      createLead: hasPermission(ctx, "lead.create"),
      ownerUpdate: hasPermission(ctx, "owner.update", ref),
      ownerFinancialRead: hasPermission(ctx, "owner.financial.read", ref),
      ownerFinancialUpdate: hasPermission(ctx, "owner.financial.update", ref),
    },
  };
}

export async function listTags(db: DbOrTx, ctx: RequestContext) {
  return db
    .select({ name: tag.name })
    .from(tag)
    .where(eq(tag.organizationId, ctx.organizationId))
    .orderBy(asc(tag.name));
}
