import { and, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { contact, contactChannel, inquiry, membership, property, user, type Db, type DbOrTx } from "@crm/db";
import {
  INQUIRY_CHANNEL_LABELS,
  INQUIRY_SLA_MINUTES,
  normalizeEmail,
  normalizePhone,
  type InquiryChannel,
  type InquiryStatus,
  type LeadSource,
} from "@crm/shared";
import {
  convertInquirySchema,
  createInquirySchema,
  inquiryActionSchema,
} from "@crm/shared/validation/communications";
import { accessFilter } from "@crm/shared/rbac";
import { writeAudit } from "../audit";
import { hasPermission, requirePermission, type RequestContext } from "../context";
import { createLead } from "../crm/leads";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, parseInput } from "../errors";
import { emitEvent, emitSystemEvent } from "../events";
import { propertyDisplayTitle } from "../properties/helpers";

type InquiryRow = typeof inquiry.$inferSelect;

const SOURCE: Record<InquiryChannel, LeadSource> = {
  web: "website",
  portal: "portal",
  whatsapp: "whatsapp",
  email: "other",
  phone: "phone",
  bot: "website",
  other: "other",
};

/** Ve las consultas sin tomar y las asignadas dentro de su alcance. */
function visibility(ctx: RequestContext): SQL | undefined {
  const f = accessFilter(ctx.grants, ctx.subject, "communication.read");
  if (f.kind === "all") return undefined;
  if (f.kind === "none") return sql`false`;
  return or(
    isNull(inquiry.assignedUserId),
    f.ownerUserIds.length ? inArray(inquiry.assignedUserId, [...f.ownerUserIds]) : sql`false`,
  );
}

function canSee(ctx: RequestContext, row: InquiryRow): boolean {
  if (!row.assignedUserId) return hasPermission(ctx, "communication.read");
  return hasPermission(ctx, "communication.read", {
    organizationId: row.organizationId,
    ownerUserId: row.assignedUserId,
    branchId: null,
    teamId: null,
  });
}

async function resolveProperty(tx: DbOrTx, organizationId: string, id: string | null, code: string | null) {
  if (!id && !code) return null;
  const [p] = await tx
    .select({ id: property.id })
    .from(property)
    .where(
      and(
        eq(property.organizationId, organizationId),
        id ? eq(property.id, id) : eq(property.code, (code ?? "").toUpperCase()),
      ),
    );
  return p?.id ?? null;
}

/** Contacto existente con el mismo teléfono o email (para no duplicar al convertir). */
async function matchContact(tx: DbOrTx, organizationId: string, phone: string | null, email: string | null) {
  const keys = [phone ? normalizePhone(phone) : null, email ? normalizeEmail(email) : null].filter(
    (k): k is string => Boolean(k),
  );
  if (!keys.length) return null;
  const [m] = await tx
    .select({ contactId: contactChannel.contactId })
    .from(contactChannel)
    .innerJoin(contact, eq(contact.id, contactChannel.contactId))
    .where(
      and(
        eq(contactChannel.organizationId, organizationId),
        inArray(contactChannel.normalized, keys),
        isNull(contact.deletedAt),
      ),
    )
    .limit(1);
  return m?.contactId ?? null;
}

/** Alta manual desde el CRM (recepción, agentes). */
export async function createInquiry(db: Db, ctx: RequestContext, rawInput: unknown) {
  if (!hasPermission(ctx, "communication.send") && !hasPermission(ctx, "lead.create"))
    throw new ForbiddenError();
  const input = parseInput(createInquirySchema, rawInput);
  return db.transaction(async (tx) => {
    const propertyId = await resolveProperty(tx, ctx.organizationId, input.propertyId, input.propertyCode);
    const contactId = await matchContact(tx, ctx.organizationId, input.phone, input.email);
    const [row] = await tx
      .insert(inquiry)
      .values({
        organizationId: ctx.organizationId,
        channel: input.channel,
        name: input.name,
        phone: input.phone,
        email: input.email,
        message: input.message,
        propertyId,
        externalRef: input.externalRef,
        contactId,
        createdById: ctx.userId,
      })
      .returning();
    if (!row) throw new Error("No se pudo registrar la consulta");
    await writeAudit(tx, ctx, {
      action: "inquiry.create",
      entityType: "inquiry",
      entityId: row.id,
      after: row,
    });
    await emitEvent(tx, ctx, {
      type: "inquiry.created",
      aggregateType: "inquiry",
      aggregateId: row.id,
      payload: { channel: input.channel },
    });
    return row;
  });
}

/**
 * Entrada desde afuera (formulario web, portal, asistente). Sin usuario: la autenticación es el
 * secreto del webhook. Idempotente por `externalRef`.
 */
export async function ingestInquiry(db: Db, organizationId: string, rawInput: unknown) {
  const input = parseInput(createInquirySchema, rawInput);
  return db.transaction(async (tx) => {
    if (input.externalRef) {
      const [dup] = await tx
        .select()
        .from(inquiry)
        .where(and(eq(inquiry.organizationId, organizationId), eq(inquiry.externalRef, input.externalRef)));
      if (dup) return { inquiry: dup, duplicate: true };
    }
    const propertyId = await resolveProperty(tx, organizationId, input.propertyId, input.propertyCode);
    const contactId = await matchContact(tx, organizationId, input.phone, input.email);
    const [row] = await tx
      .insert(inquiry)
      .values({
        organizationId,
        channel: input.channel,
        name: input.name,
        phone: input.phone,
        email: input.email,
        message: input.message,
        propertyId,
        externalRef: input.externalRef,
        contactId,
      })
      .returning();
    if (!row) throw new Error("No se pudo registrar la consulta");
    await emitSystemEvent(tx, organizationId, {
      type: "inquiry.created",
      aggregateType: "inquiry",
      aggregateId: row.id,
      payload: { channel: input.channel },
    });
    return { inquiry: row, duplicate: false };
  });
}

async function loadForWrite(tx: DbOrTx, ctx: RequestContext, id: string) {
  const [row] = await tx
    .select()
    .from(inquiry)
    .where(and(eq(inquiry.id, id), eq(inquiry.organizationId, ctx.organizationId)))
    .for("update");
  if (!row || !canSee(ctx, row)) throw new NotFoundError("Consulta");
  return row;
}

async function activeMember(tx: DbOrTx, organizationId: string, userId: string) {
  const [m] = await tx
    .select({ id: membership.id })
    .from(membership)
    .where(
      and(
        eq(membership.organizationId, organizationId),
        eq(membership.userId, userId),
        eq(membership.status, "active"),
      ),
    );
  if (!m) throw new ValidationError("La persona no es un usuario activo", { assignedUserId: ["Inválido"] });
}

export async function actOnInquiry(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(inquiryActionSchema, rawInput);
  return db.transaction(async (tx) => {
    const row = await loadForWrite(tx, ctx, input.id);
    requirePermission(ctx, "communication.send");
    const now = new Date();
    let set: Partial<InquiryRow>;
    switch (input.action) {
      case "take":
        if (row.status !== "open") throw new ConflictError("La consulta ya fue tomada");
        set = { status: "taken", assignedUserId: ctx.userId, takenAt: now };
        break;
      case "assign":
        requirePermission(ctx, "lead.assign");
        if (!input.assignedUserId)
          throw new ValidationError("Elegí a quién", { assignedUserId: ["Requerido"] });
        if (row.status === "resolved" || row.status === "rejected")
          throw new ConflictError("La consulta está cerrada");
        await activeMember(tx, ctx.organizationId, input.assignedUserId);
        set = { status: "taken", assignedUserId: input.assignedUserId, takenAt: row.takenAt ?? now };
        break;
      case "resolve":
        if (row.status === "resolved" || row.status === "rejected")
          throw new ConflictError("La consulta ya está cerrada");
        set = {
          status: "resolved",
          assignedUserId: row.assignedUserId ?? ctx.userId,
          takenAt: row.takenAt ?? now,
          closedAt: now,
          resolutionNote: input.note,
        };
        break;
      case "reject":
        if (row.status === "resolved" || row.status === "rejected")
          throw new ConflictError("La consulta ya está cerrada");
        if (!input.note) throw new ValidationError("Indicá por qué se descarta", { note: ["Requerido"] });
        set = { status: "rejected", closedAt: now, resolutionNote: input.note };
        break;
      case "reopen":
        if (row.status !== "resolved" && row.status !== "rejected")
          throw new ConflictError("La consulta está abierta");
        set = row.assignedUserId ? { status: "taken", closedAt: null } : { status: "open", closedAt: null };
        break;
    }
    const [after] = await tx.update(inquiry).set(set).where(eq(inquiry.id, row.id)).returning();
    await writeAudit(tx, ctx, {
      action: `inquiry.${input.action}`,
      entityType: "inquiry",
      entityId: row.id,
      before: { status: row.status, assignedUserId: row.assignedUserId },
      after: { status: after?.status, assignedUserId: after?.assignedUserId, note: input.note },
    });
    return after;
  });
}

/** Convierte la consulta en lead (con el contacto existente si coincide teléfono o email). */
export async function convertInquiry(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(convertInquirySchema, rawInput);
  const [row] = await db
    .select()
    .from(inquiry)
    .where(and(eq(inquiry.id, input.id), eq(inquiry.organizationId, ctx.organizationId)));
  if (!row || !canSee(ctx, row)) throw new NotFoundError("Consulta");
  if (row.leadId) throw new ConflictError("La consulta ya es un lead");
  if (row.status === "rejected") throw new ConflictError("La consulta está descartada");
  const [first = "", ...rest] = (row.name ?? "").trim().split(/\s+/);
  const channels = [
    ...(row.phone
      ? [{ type: row.channel === "whatsapp" ? ("whatsapp" as const) : ("phone" as const), value: row.phone }]
      : []),
    ...(row.email ? [{ type: "email" as const, value: row.email }] : []),
  ];
  const propertyText = row.propertyId
    ? await db
        .select({ code: property.code, title: property.title, type: property.type })
        .from(property)
        .where(eq(property.id, row.propertyId))
        .then(([p]) => (p ? ` · Propiedad ${p.code} ${propertyDisplayTitle(p)}` : ""))
    : "";
  const { lead } = await createLead(db, ctx, {
    operation: input.operation,
    source: SOURCE[row.channel],
    assignedUserId: row.assignedUserId ?? ctx.userId,
    notes: `${INQUIRY_CHANNEL_LABELS[row.channel]}: ${row.message}${propertyText}`,
    ...(row.contactId
      ? { contactId: row.contactId }
      : { contact: { firstName: first || "Sin nombre", lastName: rest.join(" ") || null, channels } }),
  });
  return db.transaction(async (tx) => {
    const now = new Date();
    const [after] = await tx
      .update(inquiry)
      .set({
        leadId: lead.id,
        contactId: lead.contactId,
        status: "resolved",
        assignedUserId: row.assignedUserId ?? ctx.userId,
        takenAt: row.takenAt ?? now,
        closedAt: now,
        resolutionNote: "Convertida en lead",
      })
      .where(eq(inquiry.id, row.id))
      .returning();
    await writeAudit(tx, ctx, {
      action: "inquiry.convert",
      entityType: "inquiry",
      entityId: row.id,
      after: { leadId: lead.id },
    });
    return { inquiry: after, leadId: lead.id };
  });
}

export async function listInquiries(
  db: DbOrTx,
  ctx: RequestContext,
  opts: { status?: InquiryStatus | "mine" | "all"; now?: Date } = {},
) {
  requirePermission(ctx, "communication.read");
  const now = opts.now ?? new Date();
  const base = and(eq(inquiry.organizationId, ctx.organizationId), visibility(ctx));
  const statusCond =
    opts.status === "mine"
      ? and(eq(inquiry.assignedUserId, ctx.userId), eq(inquiry.status, "taken"))
      : opts.status && opts.status !== "all"
        ? eq(inquiry.status, opts.status)
        : undefined;
  const rows = await db
    .select({
      i: inquiry,
      assignedName: user.name,
      propertyCode: property.code,
      propertyTitle: property.title,
      propertyType: property.type,
      contactName: contact.displayName,
    })
    .from(inquiry)
    .leftJoin(user, eq(user.id, inquiry.assignedUserId))
    .leftJoin(property, eq(property.id, inquiry.propertyId))
    .leftJoin(contact, eq(contact.id, inquiry.contactId))
    .where(and(base, statusCond))
    .orderBy(
      sql`case ${inquiry.status} when 'open' then 0 when 'taken' then 1 else 2 end`,
      desc(inquiry.createdAt),
    )
    .limit(300);
  const counts = await db
    .select({ status: inquiry.status, n: sql<number>`count(*)::int` })
    .from(inquiry)
    .where(base)
    .groupBy(inquiry.status);
  const [mine] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(inquiry)
    .where(and(base, eq(inquiry.assignedUserId, ctx.userId), eq(inquiry.status, "taken")));
  const sla = INQUIRY_SLA_MINUTES * 60_000;
  return {
    items: rows.map((r) => ({
      ...r.i,
      assignedName: r.assignedName,
      contactName: r.contactName,
      propertyLabel: r.propertyCode
        ? `${r.propertyCode} · ${propertyDisplayTitle({ title: r.propertyTitle, type: r.propertyType ?? "apartment", code: r.propertyCode })}`
        : null,
      late: r.i.status === "open" && now.getTime() - r.i.createdAt.getTime() > sla,
      waitingMinutes: Math.round(((r.i.takenAt ?? now).getTime() - r.i.createdAt.getTime()) / 60_000),
    })),
    counts: {
      ...(Object.fromEntries(counts.map((c) => [c.status, c.n])) as Partial<Record<InquiryStatus, number>>),
      mine: mine?.n ?? 0,
    },
    permissions: {
      act: hasPermission(ctx, "communication.send"),
      assign: hasPermission(ctx, "lead.assign"),
      convert: hasPermission(ctx, "lead.create"),
    },
  };
}

/** Consultas abiertas (para el dashboard y el aviso del menú). */
export async function openInquiriesCount(db: DbOrTx, ctx: RequestContext) {
  if (!hasPermission(ctx, "communication.read")) return null;
  const [r] = await db
    .select({
      open: sql<number>`count(*) filter (where ${inquiry.status} = 'open')::int`,
      late: sql<number>`count(*) filter (where ${inquiry.status} = 'open' and ${inquiry.createdAt} < now() - (${INQUIRY_SLA_MINUTES} || ' minutes')::interval)::int`,
      mine: sql<number>`count(*) filter (where ${inquiry.status} = 'taken' and ${inquiry.assignedUserId} = ${ctx.userId})::int`,
    })
    .from(inquiry)
    .where(and(eq(inquiry.organizationId, ctx.organizationId), visibility(ctx)));
  return r ?? { open: 0, late: 0, mine: 0 };
}
