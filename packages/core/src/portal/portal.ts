import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import {
  activity,
  calendarEvent,
  contact,
  contactChannel,
  deal,
  dealOffer,
  locality,
  neighborhood,
  notification,
  organization,
  ownerPortalAccess,
  ownerProfile,
  ownerSettlement,
  property,
  propertyMedia,
  propertyOwner,
  propertyPrice,
  propertyPublication,
  rentalContract,
  rentCharge,
  session,
  user,
  type Db,
  type DbOrTx,
} from "@crm/db";
import { insertCredentialUser } from "@crm/db/credentials";
import { chargeStatus } from "@crm/shared/billing";
import { uuidSchema } from "@crm/shared/validation";
import { writeAudit } from "../audit";
import { contactRef } from "../crm/helpers";
import { orgLogoUrl, requirePermission, type RequestContext } from "../context";
import { ConflictError, NotFoundError, ValidationError, parseInput } from "../errors";

const INVITE_DAYS = 7;
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export const portalInviteSchema = z.object({
  contactId: uuidSchema,
  email: z
    .email("Email inválido")
    .max(200)
    .transform((v) => v.trim().toLowerCase()),
});
export const portalActivateSchema = z
  .object({
    token: z.string().regex(/^[0-9a-f]{64}$/, "Enlace inválido"),
    password: z.string().min(10, "La contraseña necesita al menos 10 caracteres").max(128),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Las contraseñas no coinciden" });
export const portalMessageSchema = z.object({
  propertyId: uuidSchema.optional().nullable(),
  message: z.string().trim().min(3, "Escribí el mensaje").max(2000),
});

async function loadOwnerContact(tx: DbOrTx, ctx: RequestContext, contactId: string) {
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
  requirePermission(ctx, "owner.update", contactRef(c));
  return { id: c.id, name: c.displayName };
}

/** Estado del acceso al portal de un propietario (para la ficha del contacto). */
export async function portalAccessFor(db: DbOrTx, ctx: RequestContext, contactId: string) {
  requirePermission(ctx, "owner.read");
  const [a] = await db
    .select()
    .from(ownerPortalAccess)
    .where(
      and(
        eq(ownerPortalAccess.organizationId, ctx.organizationId),
        eq(ownerPortalAccess.contactId, parseInput(uuidSchema, contactId)),
      ),
    );
  if (!a) return null;
  return {
    status: a.status,
    email: a.email,
    inviteExpiresAt: a.inviteExpiresAt,
    activatedAt: a.activatedAt,
    lastSeenAt: a.lastSeenAt,
  };
}

/**
 * Invita (o vuelve a invitar) a un propietario. Devuelve el token en claro una sola vez: el
 * enlace `/portal/activar/<token>` se lo manda quien invita (WhatsApp o email).
 */
export async function inviteOwnerToPortal(db: Db, ctx: RequestContext, rawInput: unknown) {
  requirePermission(ctx, "owner.update");
  const input = parseInput(portalInviteSchema, rawInput);
  return db.transaction(async (tx) => {
    const c = await loadOwnerContact(tx, ctx, input.contactId);
    const [isOwner] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(propertyOwner)
      .where(eq(propertyOwner.contactId, c.id));
    const [profile] = await tx.select().from(ownerProfile).where(eq(ownerProfile.contactId, c.id));
    if (!profile && !(isOwner?.n ?? 0))
      throw new ConflictError(
        "El portal es para propietarios: este contacto no tiene propiedades a su nombre",
      );
    const [existing] = await tx
      .select()
      .from(ownerPortalAccess)
      .where(
        and(eq(ownerPortalAccess.organizationId, ctx.organizationId), eq(ownerPortalAccess.contactId, c.id)),
      );
    if (existing?.status === "active") throw new ConflictError("El propietario ya tiene acceso al portal");
    const [taken] = await tx.select({ id: user.id }).from(user).where(eq(user.email, input.email));
    if (taken)
      throw new ValidationError("Ese email ya tiene un usuario. Usá otro email del propietario.", {
        email: ["Ya está en uso"],
      });
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);
    const values = {
      email: input.email,
      status: "invited" as const,
      userId: null,
      inviteTokenHash: hashToken(token),
      inviteExpiresAt: expiresAt,
      invitedById: ctx.userId,
    };
    if (existing) await tx.update(ownerPortalAccess).set(values).where(eq(ownerPortalAccess.id, existing.id));
    else
      await tx
        .insert(ownerPortalAccess)
        .values({ organizationId: ctx.organizationId, contactId: c.id, ...values });
    await writeAudit(tx, ctx, {
      action: "portal.invite",
      entityType: "contact",
      entityId: c.id,
      after: { email: input.email, expiresAt },
    });
    return { token, expiresAt, ownerName: c.name };
  });
}

/** Quita el acceso y cierra las sesiones abiertas del propietario. */
export async function revokePortalAccess(db: Db, ctx: RequestContext, contactId: string) {
  requirePermission(ctx, "owner.update");
  const id = parseInput(uuidSchema, contactId);
  return db.transaction(async (tx) => {
    await loadOwnerContact(tx, ctx, id);
    const [a] = await tx
      .select()
      .from(ownerPortalAccess)
      .where(
        and(eq(ownerPortalAccess.organizationId, ctx.organizationId), eq(ownerPortalAccess.contactId, id)),
      );
    if (!a || a.status === "revoked") throw new NotFoundError("Acceso al portal");
    await tx
      .update(ownerPortalAccess)
      .set({ status: "revoked", inviteTokenHash: null, inviteExpiresAt: null })
      .where(eq(ownerPortalAccess.id, a.id));
    if (a.userId) await tx.delete(session).where(eq(session.userId, a.userId));
    await writeAudit(tx, ctx, {
      action: "portal.revoke",
      entityType: "contact",
      entityId: id,
      before: { status: a.status },
    });
  });
}

/** Datos de la invitación para la pantalla de activación (sin sesión). */
export async function portalInviteInfo(db: DbOrTx, token: string) {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const [r] = await db
    .select({
      a: ownerPortalAccess,
      name: contact.displayName,
      org: organization.name,
      logoKey: organization.logoKey,
      logoAt: organization.logoUpdatedAt,
    })
    .from(ownerPortalAccess)
    .innerJoin(contact, eq(contact.id, ownerPortalAccess.contactId))
    .innerJoin(organization, eq(organization.id, ownerPortalAccess.organizationId))
    .where(eq(ownerPortalAccess.inviteTokenHash, hashToken(token)));
  if (!r || r.a.status !== "invited" || !r.a.inviteExpiresAt || r.a.inviteExpiresAt < new Date()) return null;
  return {
    ownerName: r.name,
    orgName: r.org,
    email: r.a.email,
    logoUrl: orgLogoUrl(r.a.organizationId, r.logoKey, r.logoAt),
  };
}

/** Activa la invitación: crea el usuario con la contraseña elegida. */
export async function activatePortalAccess(db: Db, rawInput: unknown) {
  const input = parseInput(portalActivateSchema, rawInput);
  return db.transaction(async (tx) => {
    const [r] = await tx
      .select({ a: ownerPortalAccess, name: contact.displayName })
      .from(ownerPortalAccess)
      .innerJoin(contact, eq(contact.id, ownerPortalAccess.contactId))
      .where(eq(ownerPortalAccess.inviteTokenHash, hashToken(input.token)))
      .for("update", { of: ownerPortalAccess });
    if (!r || r.a.status !== "invited" || !r.a.inviteExpiresAt || r.a.inviteExpiresAt < new Date())
      throw new ConflictError("La invitación venció o ya se usó. Pedile una nueva a la inmobiliaria.");
    const [taken] = await tx.select({ id: user.id }).from(user).where(eq(user.email, r.a.email));
    if (taken)
      throw new ConflictError("Ese email ya tiene un usuario. Pedile a la inmobiliaria otra invitación.");
    const u = await insertCredentialUser(tx, { name: r.name, email: r.a.email, password: input.password });
    await tx
      .update(ownerPortalAccess)
      .set({
        status: "active",
        userId: u.id,
        inviteTokenHash: null,
        inviteExpiresAt: null,
        activatedAt: new Date(),
      })
      .where(eq(ownerPortalAccess.id, r.a.id));
    return { email: r.a.email };
  });
}

export interface PortalContext {
  userId: string;
  organizationId: string;
  contactId: string;
  ownerName: string;
  orgName: string;
  timezone: string;
  logoUrl: string | null;
}

/** Contexto del portal para un usuario (null si no es un propietario con acceso activo). */
export async function loadPortalContext(db: DbOrTx, userId: string): Promise<PortalContext | null> {
  const [r] = await db
    .select({
      a: ownerPortalAccess,
      name: contact.displayName,
      org: organization.name,
      tz: organization.timezone,
      logoKey: organization.logoKey,
      logoAt: organization.logoUpdatedAt,
    })
    .from(ownerPortalAccess)
    .innerJoin(contact, eq(contact.id, ownerPortalAccess.contactId))
    .innerJoin(organization, eq(organization.id, ownerPortalAccess.organizationId))
    .where(and(eq(ownerPortalAccess.userId, userId), eq(ownerPortalAccess.status, "active")));
  if (!r) return null;
  if (!r.a.lastSeenAt || Date.now() - r.a.lastSeenAt.getTime() > 10 * 60_000)
    await db
      .update(ownerPortalAccess)
      .set({ lastSeenAt: new Date() })
      .where(eq(ownerPortalAccess.id, r.a.id));
  return {
    userId,
    organizationId: r.a.organizationId,
    contactId: r.a.contactId,
    ownerName: r.name,
    orgName: r.org,
    timezone: r.tz || "America/Montevideo",
    logoUrl: orgLogoUrl(r.a.organizationId, r.logoKey, r.logoAt),
  };
}

async function ownedPropertyIds(db: DbOrTx, p: PortalContext) {
  const rows = await db
    .select({ id: propertyOwner.propertyId, share: propertyOwner.shareBasisPoints })
    .from(propertyOwner)
    .innerJoin(property, eq(property.id, propertyOwner.propertyId))
    .where(
      and(
        eq(propertyOwner.contactId, p.contactId),
        eq(property.organizationId, p.organizationId),
        isNull(property.deletedAt),
      ),
    );
  return new Map(rows.map((r) => [r.id, r.share]));
}

/** Resumen del portal: propiedades del propietario con sus números principales. */
export async function portalOverview(db: DbOrTx, p: PortalContext) {
  const owned = await ownedPropertyIds(db, p);
  const ids = [...owned.keys()];
  if (!ids.length) return { properties: [], agent: null };
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000);
  const [props, prices, covers, pubs, visits, offers, contracts] = await Promise.all([
    db
      .select({
        p: property,
        localityName: locality.name,
        neighborhoodName: neighborhood.name,
        agentName: user.name,
        agentEmail: user.email,
      })
      .from(property)
      .leftJoin(locality, eq(locality.id, property.localityId))
      .leftJoin(neighborhood, eq(neighborhood.id, property.neighborhoodId))
      .leftJoin(user, eq(user.id, property.assignedUserId))
      .where(inArray(property.id, ids))
      .orderBy(asc(property.code)),
    db.select().from(propertyPrice).where(inArray(propertyPrice.propertyId, ids)),
    db
      .select({ id: propertyMedia.id, propertyId: propertyMedia.propertyId })
      .from(propertyMedia)
      .where(
        and(
          inArray(propertyMedia.propertyId, ids),
          eq(propertyMedia.kind, "photo"),
          eq(propertyMedia.isCover, true),
        ),
      ),
    db
      .select({
        propertyId: propertyPublication.propertyId,
        n: sql<number>`count(*) filter (where ${propertyPublication.status} = 'published')::int`,
        views: sql<number>`coalesce(sum(${propertyPublication.views}), 0)::int`,
        contacts: sql<number>`coalesce(sum(${propertyPublication.contacts}), 0)::int`,
      })
      .from(propertyPublication)
      .where(inArray(propertyPublication.propertyId, ids))
      .groupBy(propertyPublication.propertyId),
    db
      .select({
        propertyId: calendarEvent.propertyId,
        done: sql<number>`count(*) filter (where ${calendarEvent.status} = 'done' and ${calendarEvent.startsAt} >= ${ninetyDaysAgo})::int`,
        upcoming: sql<number>`count(*) filter (where ${calendarEvent.status} = 'scheduled' and ${calendarEvent.startsAt} >= now())::int`,
      })
      .from(calendarEvent)
      .where(and(inArray(calendarEvent.propertyId, ids), eq(calendarEvent.type, "visit")))
      .groupBy(calendarEvent.propertyId),
    db
      .select({ propertyId: deal.propertyId, n: sql<number>`count(*)::int` })
      .from(dealOffer)
      .innerJoin(deal, eq(deal.id, dealOffer.dealId))
      .where(and(inArray(deal.propertyId, ids), isNull(deal.deletedAt), eq(dealOffer.party, "client")))
      .groupBy(deal.propertyId),
    db
      .select({ propertyId: rentalContract.propertyId, endDate: rentalContract.endDate })
      .from(rentalContract)
      .where(
        and(
          inArray(rentalContract.propertyId, ids),
          eq(rentalContract.status, "active"),
          isNull(rentalContract.deletedAt),
        ),
      ),
  ]);
  const first = props[0];
  return {
    agent: first?.agentName ? { name: first.agentName, email: first.agentEmail } : null,
    properties: props.map((r) => ({
      id: r.p.id,
      code: r.p.code,
      title: r.p.title,
      type: r.p.type,
      status: r.p.status,
      zone: [r.neighborhoodName, r.localityName].filter(Boolean).join(", "),
      shareBasisPoints: owned.get(r.p.id) ?? 0,
      prices: prices
        .filter((x) => x.propertyId === r.p.id && x.listMinor !== null)
        .map((x) => ({
          operation: x.operation,
          currency: x.currency,
          listMinor: (x.listMinor ?? 0n).toString(),
        })),
      coverId: covers.find((c) => c.propertyId === r.p.id)?.id ?? null,
      publications: pubs.find((x) => x.propertyId === r.p.id) ?? { n: 0, views: 0, contacts: 0 },
      visits: visits.find((x) => x.propertyId === r.p.id) ?? { done: 0, upcoming: 0 },
      offers: offers.find((x) => x.propertyId === r.p.id)?.n ?? 0,
      contractEnd: contracts.find((x) => x.propertyId === r.p.id)?.endDate ?? null,
      agentName: r.agentName,
    })),
  };
}

/** Detalle de una propiedad del propietario: avisos, visitas, ofertas, contrato y liquidaciones. */
export async function portalProperty(db: DbOrTx, p: PortalContext, propertyId: string, today: string) {
  const id = parseInput(uuidSchema, propertyId);
  const owned = await ownedPropertyIds(db, p);
  if (!owned.has(id)) throw new NotFoundError("Propiedad");
  const overview = await portalOverview(db, p);
  const base = overview.properties.find((x) => x.id === id);
  if (!base) throw new NotFoundError("Propiedad");
  const [pubs, visits, offers, contract, photos] = await Promise.all([
    db
      .select({
        portal: propertyPublication.portal,
        status: propertyPublication.status,
        url: propertyPublication.url,
        views: propertyPublication.views,
        contacts: propertyPublication.contacts,
        publishedAt: propertyPublication.publishedAt,
      })
      .from(propertyPublication)
      .where(and(eq(propertyPublication.propertyId, id), ne(propertyPublication.status, "removed"))),
    db
      .select({
        startsAt: calendarEvent.startsAt,
        status: calendarEvent.status,
        outcome: calendarEvent.outcome,
        rating: calendarEvent.rating,
        feedback: calendarEvent.feedback,
      })
      .from(calendarEvent)
      .where(
        and(
          eq(calendarEvent.propertyId, id),
          eq(calendarEvent.type, "visit"),
          gte(calendarEvent.startsAt, new Date(Date.now() - 365 * 86_400_000)),
        ),
      )
      .orderBy(desc(calendarEvent.startsAt))
      .limit(50),
    db
      .select({
        createdAt: dealOffer.createdAt,
        party: dealOffer.party,
        currency: dealOffer.currency,
        amountMinor: dealOffer.amountMinor,
        status: dealOffer.status,
        operation: deal.operation,
      })
      .from(dealOffer)
      .innerJoin(deal, eq(deal.id, dealOffer.dealId))
      .where(and(eq(deal.propertyId, id), isNull(deal.deletedAt)))
      .orderBy(desc(dealOffer.createdAt))
      .limit(50),
    db
      .select({ c: rentalContract, tenant: contact.displayName })
      .from(rentalContract)
      .innerJoin(contact, eq(contact.id, rentalContract.tenantContactId))
      .where(and(eq(rentalContract.propertyId, id), isNull(rentalContract.deletedAt)))
      .orderBy(desc(rentalContract.startDate))
      .limit(1),
    db
      .select({ id: propertyMedia.id })
      .from(propertyMedia)
      .where(and(eq(propertyMedia.propertyId, id), eq(propertyMedia.kind, "photo")))
      .orderBy(desc(propertyMedia.isCover), asc(propertyMedia.position))
      .limit(12),
  ]);
  const c = contract[0];
  let charges: {
    period: string;
    dueDate: string;
    currency: "UYU" | "USD";
    totalMinor: string;
    paidMinor: string;
    status: string;
  }[] = [];
  let settlements: {
    code: string;
    period: string;
    currency: "UYU" | "USD";
    incomeMinor: string;
    feeMinor: string;
    deductionsMinor: string;
    myAmountMinor: string;
    status: string;
    paidAt: string | null;
  }[] = [];
  if (c) {
    const rows = await db
      .select({
        ch: rentCharge,
        total: sql<string>`coalesce((select sum(case when l.kind = 'discount' then -l.amount_minor else l.amount_minor end) from rent_charge_line l where l.charge_id = "rent_charge"."id"), 0)`,
        paid: sql<string>`coalesce((select sum(p.amount_minor) from rent_payment p where p.charge_id = "rent_charge"."id"), 0)`,
      })
      .from(rentCharge)
      .where(eq(rentCharge.contractId, c.c.id))
      .orderBy(desc(rentCharge.period))
      .limit(12);
    charges = rows.map((r) => ({
      period: r.ch.period,
      dueDate: r.ch.dueDate,
      currency: r.ch.currency,
      totalMinor: r.total,
      paidMinor: r.paid,
      status: chargeStatus(BigInt(r.total), BigInt(r.paid), r.ch.dueDate, today),
    }));
    const sets = await db
      .select({ s: ownerSettlement, period: rentCharge.period })
      .from(ownerSettlement)
      .innerJoin(rentCharge, eq(rentCharge.id, ownerSettlement.chargeId))
      .where(
        and(eq(ownerSettlement.contractId, c.c.id), inArray(ownerSettlement.status, ["approved", "paid"])),
      )
      .orderBy(desc(rentCharge.period))
      .limit(24);
    settlements = sets.map(({ s, period }) => ({
      code: s.code,
      period,
      currency: s.currency,
      incomeMinor: s.incomeMinor.toString(),
      feeMinor: s.feeMinor.toString(),
      deductionsMinor: s.deductionsMinor.toString(),
      myAmountMinor: s.shares.find((x) => x.contactId === p.contactId)?.amountMinor ?? "0",
      status: s.status,
      paidAt: s.paidAt,
    }));
  }
  return {
    property: base,
    photos: photos.map((x) => x.id),
    publications: pubs,
    visits,
    offers: offers.map((o) => ({ ...o, amountMinor: o.amountMinor.toString() })),
    contract: c
      ? {
          code: c.c.code,
          tenantName: c.tenant,
          startDate: c.c.startDate,
          endDate: c.c.endDate,
          status: c.c.status,
          currency: c.c.currency,
          rentMinor: c.c.rentMinor.toString(),
        }
      : null,
    charges,
    settlements,
  };
}

/** Foto de una propiedad del propietario. */
export async function readPortalMedia(
  db: DbOrTx,
  storage: { get(key: string): Promise<Buffer> },
  p: PortalContext,
  mediaId: string,
  size: "full" | "thumb",
) {
  if (!uuidSchema.safeParse(mediaId).success) return null;
  const [m] = await db.select().from(propertyMedia).where(eq(propertyMedia.id, mediaId));
  if (!m || m.kind !== "photo") return null;
  if (!(await ownedPropertyIds(db, p)).has(m.propertyId)) return null;
  const key = size === "thumb" ? (m.thumbKey ?? m.storageKey) : m.storageKey;
  if (!key) return null;
  return { body: await storage.get(key), mimeType: m.mimeType ?? "image/webp" };
}

/** Mensaje del propietario a su agente: notificación + registro en el timeline del contacto. */
export async function sendOwnerMessage(db: Db, p: PortalContext, rawInput: unknown) {
  const input = parseInput(portalMessageSchema, rawInput);
  const owned = await ownedPropertyIds(db, p);
  if (input.propertyId && !owned.has(input.propertyId)) throw new NotFoundError("Propiedad");
  return db.transaction(async (tx) => {
    let to: string | null = null;
    let label = "";
    if (input.propertyId) {
      const [pr] = await tx
        .select({ a: property.assignedUserId, code: property.code })
        .from(property)
        .where(eq(property.id, input.propertyId));
      to = pr?.a ?? null;
      label = pr ? ` (${pr.code})` : "";
    }
    if (!to) {
      const [c] = await tx
        .select({ a: contact.assignedUserId })
        .from(contact)
        .where(eq(contact.id, p.contactId));
      to = c?.a ?? null;
    }
    if (!to && owned.size) {
      const [pr] = await tx
        .select({ a: property.assignedUserId })
        .from(property)
        .where(and(inArray(property.id, [...owned.keys()]), sql`${property.assignedUserId} is not null`))
        .limit(1);
      to = pr?.a ?? null;
    }
    await tx.insert(activity).values({
      organizationId: p.organizationId,
      contactId: p.contactId,
      type: "note",
      direction: "inbound",
      body: `Mensaje desde el portal${label}: ${input.message}`,
      payload: { source: "owner_portal", propertyId: input.propertyId ?? null },
    });
    if (to)
      await tx.insert(notification).values({
        organizationId: p.organizationId,
        userId: to,
        title: `Mensaje de ${p.ownerName}${label}`,
        body: input.message.slice(0, 600),
        href: `/crm/contacts/${p.contactId}?tab=timeline`,
      });
    return { delivered: Boolean(to) };
  });
}

/** Email principal del contacto (para sugerirlo al invitar). */
export async function contactEmail(db: DbOrTx, ctx: RequestContext, contactId: string) {
  requirePermission(ctx, "owner.read");
  const [r] = await db
    .select({ v: contactChannel.value })
    .from(contactChannel)
    .innerJoin(contact, eq(contact.id, contactChannel.contactId))
    .where(
      and(
        eq(contactChannel.contactId, parseInput(uuidSchema, contactId)),
        eq(contact.organizationId, ctx.organizationId),
        eq(contactChannel.type, "email"),
      ),
    )
    .orderBy(desc(contactChannel.isPrimary))
    .limit(1);
  return r?.v ?? null;
}

/** Una liquidación del propietario (para imprimir), con su parte. */
export async function portalSettlement(db: DbOrTx, p: PortalContext, code: string) {
  if (!/^LIQ-\d{6}$/.test(code)) throw new NotFoundError("Liquidación");
  const [r] = await db
    .select({
      s: ownerSettlement,
      period: rentCharge.period,
      propertyId: rentalContract.propertyId,
      contractCode: rentalContract.code,
      tenant: contact.displayName,
      propertyCode: property.code,
      propertyTitle: property.title,
    })
    .from(ownerSettlement)
    .innerJoin(rentCharge, eq(rentCharge.id, ownerSettlement.chargeId))
    .innerJoin(rentalContract, eq(rentalContract.id, ownerSettlement.contractId))
    .innerJoin(contact, eq(contact.id, rentalContract.tenantContactId))
    .innerJoin(property, eq(property.id, rentalContract.propertyId))
    .where(
      and(
        eq(ownerSettlement.organizationId, p.organizationId),
        eq(ownerSettlement.code, code),
        inArray(ownerSettlement.status, ["approved", "paid"]),
      ),
    );
  if (!r || !(await ownedPropertyIds(db, p)).has(r.propertyId)) throw new NotFoundError("Liquidación");
  return {
    ...r.s,
    period: r.period,
    contractCode: r.contractCode,
    tenantName: r.tenant,
    propertyLabel: r.propertyTitle ? `${r.propertyCode} · ${r.propertyTitle}` : r.propertyCode,
    myShare: r.s.shares.find((x) => x.contactId === p.contactId) ?? null,
  };
}
