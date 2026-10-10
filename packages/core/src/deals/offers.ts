import { and, asc, desc, eq, inArray, isNull, lte, sql, type SQL } from "drizzle-orm";
import {
  contact,
  deal,
  dealCommission,
  dealOffer,
  dealReservation,
  property,
  user,
  type Db,
  type DbOrTx,
} from "@crm/db";
import {
  DEPOSIT_HOLDER_LABELS,
  OFFER_PARTY_LABELS,
  RESERVATION_STATUS_LABELS,
  formatMoney,
  money,
  otherParty,
  percentage,
  type Currency,
  type OfferStatus,
  type ReservationStatus,
} from "@crm/shared";
import {
  cancelReservationSchema,
  createOfferSchema,
  createReservationSchema,
  extendReservationSchema,
  updateReservationSchema,
  respondOfferSchema,
} from "@crm/shared/validation/offers";
import { uuidSchema } from "@crm/shared/validation";
import { writeAudit } from "../audit";
import { hasPermission, requirePermission, type RequestContext } from "../context";
import { logActivity } from "../crm/helpers";
import { ConflictError, NotFoundError, ValidationError, parseInput } from "../errors";
import { emitEvent } from "../events";
import { propertyDisplayTitle } from "../properties/helpers";
import { applyDealStage, dealRef, dealScope, loadDealForWrite, type DealRow } from "./deals";

const fmt = (amountMinor: bigint, currency: Currency) => formatMoney(money(amountMinor, currency));
const fmtDate = (ymd: string) => ymd.split("-").reverse().join("/");

async function pendingOffer(tx: DbOrTx, dealId: string) {
  const [o] = await tx
    .select()
    .from(dealOffer)
    .where(and(eq(dealOffer.dealId, dealId), eq(dealOffer.status, "pending")));
  return o ?? null;
}

async function activeReservation(tx: DbOrTx, dealId: string) {
  const [r] = await tx
    .select()
    .from(dealReservation)
    .where(and(eq(dealReservation.dealId, dealId), eq(dealReservation.status, "active")));
  return r ?? null;
}

function requireNegotiating(d: DealRow) {
  if (d.stage !== "negotiation")
    throw new ConflictError("Las ofertas se registran mientras la operación está en negociación");
}

// ---------------------------------------------------------------------------------------------
// Ofertas
// ---------------------------------------------------------------------------------------------

export async function createOffer(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(createOfferSchema, rawInput);
  return db.transaction(async (tx) => {
    const d = await loadDealForWrite(tx, ctx, input.dealId);
    requirePermission(ctx, "offer.manage", dealRef(d));
    requireNegotiating(d);
    if (await pendingOffer(tx, d.id))
      throw new ConflictError("Ya hay una oferta sin responder: aceptala, rechazala o contraofertala");
    const [row] = await tx
      .insert(dealOffer)
      .values({
        organizationId: ctx.organizationId,
        dealId: d.id,
        party: input.party,
        currency: input.currency,
        amountMinor: input.amountMinor,
        conditions: input.conditions,
        validUntil: input.validUntil,
        createdById: ctx.userId,
      })
      .returning();
    if (!row) throw new Error("No se pudo registrar la oferta");
    await logActivity(tx, ctx, {
      type: "offer",
      contactId: d.clientContactId,
      leadId: d.leadId,
      body: `${d.code}: oferta del ${OFFER_PARTY_LABELS[input.party].toLowerCase()} por ${fmt(input.amountMinor, input.currency)}${input.conditions ? ` · ${input.conditions}` : ""}`,
      payload: { dealId: d.id, offerId: row.id },
    });
    await writeAudit(tx, ctx, { action: "offer.create", entityType: "deal", entityId: d.id, after: row });
    await emitEvent(tx, ctx, {
      type: "offer.created",
      aggregateType: "deal",
      aggregateId: d.id,
      payload: { offerId: row.id, party: input.party },
    });
    return row;
  });
}

/** Aceptar, rechazar, retirar o contraofertar la oferta pendiente. */
export async function respondOffer(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(respondOfferSchema, rawInput);
  return db.transaction(async (tx) => {
    const [o] = await tx
      .select()
      .from(dealOffer)
      .where(and(eq(dealOffer.id, input.offerId), eq(dealOffer.organizationId, ctx.organizationId)))
      .for("update");
    if (!o) throw new NotFoundError("Oferta");
    const d = await loadDealForWrite(tx, ctx, o.dealId);
    requirePermission(ctx, "offer.manage", dealRef(d));
    requireNegotiating(d);
    if (o.status !== "pending") throw new ConflictError("La oferta ya fue respondida");

    const status: OfferStatus =
      input.response === "accept"
        ? "accepted"
        : input.response === "reject"
          ? "rejected"
          : input.response === "withdraw"
            ? "withdrawn"
            : "countered";
    const now = new Date();
    const [after] = await tx
      .update(dealOffer)
      .set({ status, respondedAt: now, respondedById: ctx.userId, responseNote: input.note })
      .where(eq(dealOffer.id, o.id))
      .returning();

    let counter: typeof dealOffer.$inferSelect | null = null;
    if (input.response === "counter") {
      const currency = input.currency ?? o.currency;
      if (input.amountMinor === null) throw new ValidationError("Indicá el monto", { amount: ["Requerido"] });
      [counter] = (await tx
        .insert(dealOffer)
        .values({
          organizationId: ctx.organizationId,
          dealId: d.id,
          previousOfferId: o.id,
          party: otherParty(o.party),
          currency,
          amountMinor: input.amountMinor,
          conditions: input.conditions,
          validUntil: input.validUntil,
          createdById: ctx.userId,
        })
        .returning()) as [typeof dealOffer.$inferSelect];
    }

    // Aceptada: el precio de la operación pasa a ser el acordado.
    if (input.response === "accept" && (d.priceMinor !== o.amountMinor || d.currency !== o.currency)) {
      await tx.update(deal).set({ priceMinor: o.amountMinor, currency: o.currency }).where(eq(deal.id, d.id));
      await writeAudit(tx, ctx, {
        action: "deal.update",
        entityType: "deal",
        entityId: d.id,
        before: { priceMinor: d.priceMinor, currency: d.currency },
        after: { priceMinor: o.amountMinor, currency: o.currency, fromOfferId: o.id },
      });
      // Los honorarios sugeridos por la comisión pactada (y todavía pendientes) siguen al precio.
      const [p] = await tx
        .select({ bp: property.commissionBasisPoints })
        .from(property)
        .where(eq(property.id, d.propertyId));
      if (p?.bp) {
        const suggested = percentage(money(d.priceMinor, d.currency), p.bp).amountMinor;
        const next = percentage(money(o.amountMinor, o.currency), p.bp).amountMinor;
        await tx
          .update(dealCommission)
          .set({ amountMinor: next, currency: o.currency })
          .where(
            and(
              eq(dealCommission.dealId, d.id),
              eq(dealCommission.status, "pending"),
              eq(dealCommission.currency, d.currency),
              eq(dealCommission.amountMinor, suggested),
            ),
          );
      }
    }

    const who = OFFER_PARTY_LABELS[o.party].toLowerCase();
    const body =
      input.response === "accept"
        ? `${d.code}: se aceptó la oferta del ${who} por ${fmt(o.amountMinor, o.currency)}`
        : input.response === "reject"
          ? `${d.code}: se rechazó la oferta del ${who} por ${fmt(o.amountMinor, o.currency)}`
          : input.response === "withdraw"
            ? `${d.code}: el ${who} retiró su oferta`
            : `${d.code}: contraoferta del ${OFFER_PARTY_LABELS[otherParty(o.party)].toLowerCase()} por ${fmt(counter?.amountMinor ?? 0n, counter?.currency ?? o.currency)}`;
    await logActivity(tx, ctx, {
      type: "offer",
      contactId: d.clientContactId,
      leadId: d.leadId,
      body: `${body}${input.note ? ` · ${input.note}` : ""}`,
      payload: { dealId: d.id, offerId: o.id, response: input.response, counterOfferId: counter?.id ?? null },
    });
    await writeAudit(tx, ctx, {
      action: `offer.${input.response}`,
      entityType: "deal",
      entityId: d.id,
      before: { offerId: o.id, status: o.status },
      after: { status, counterOfferId: counter?.id ?? null },
    });
    await emitEvent(tx, ctx, {
      type: `offer.${status}`,
      aggregateType: "deal",
      aggregateId: d.id,
      payload: { offerId: o.id },
    });
    return { offer: after, counter };
  });
}

type OfferListRow = typeof dealOffer.$inferSelect & { createdByName: string | null };

/** Historial de ofertas de una operación (la más reciente primero). */
export async function dealOffers(db: DbOrTx, ctx: RequestContext, dealId: string) {
  const id = parseInput(uuidSchema, dealId);
  const [d] = await db
    .select()
    .from(deal)
    .where(
      and(
        eq(deal.id, id),
        eq(deal.organizationId, ctx.organizationId),
        isNull(deal.deletedAt),
        dealScope(ctx),
      ),
    );
  if (!d) throw new NotFoundError("Operación");
  const ref = dealRef(d);
  if (!hasPermission(ctx, "offer.read"))
    return {
      offers: [] as OfferListRow[],
      reservations: [],
      canManageOffers: false,
      canManageReservations: false,
    };
  const [offers, reservations] = await Promise.all([
    db
      .select({ o: dealOffer, createdByName: user.name })
      .from(dealOffer)
      .leftJoin(user, eq(user.id, dealOffer.createdById))
      .where(eq(dealOffer.dealId, id))
      .orderBy(desc(dealOffer.createdAt)),
    hasPermission(ctx, "reservation.read")
      ? db
          .select()
          .from(dealReservation)
          .where(eq(dealReservation.dealId, id))
          .orderBy(desc(dealReservation.createdAt))
      : Promise.resolve([]),
  ]);
  return {
    offers: offers.map((x) => ({ ...x.o, createdByName: x.createdByName })),
    reservations,
    canManageOffers: hasPermission(ctx, "offer.manage", ref),
    canManageReservations: hasPermission(ctx, "reservation.manage", ref),
  };
}

/** Bandeja de ofertas: pendientes primero (con vencimiento), después el historial reciente. */
export async function listOffers(
  db: DbOrTx,
  ctx: RequestContext,
  opts: { status?: "pending" | "all"; propertyId?: string; contactId?: string } = {},
) {
  requirePermission(ctx, "offer.read");
  const conditions: (SQL | undefined)[] = [
    eq(dealOffer.organizationId, ctx.organizationId),
    isNull(deal.deletedAt),
    dealScope(ctx),
    opts.status === "pending" ? eq(dealOffer.status, "pending") : undefined,
    opts.propertyId ? eq(deal.propertyId, parseInput(uuidSchema, opts.propertyId)) : undefined,
    opts.contactId ? eq(deal.clientContactId, parseInput(uuidSchema, opts.contactId)) : undefined,
  ];
  const rows = await db
    .select({
      o: dealOffer,
      dealCode: deal.code,
      dealStage: deal.stage,
      operation: deal.operation,
      listCurrency: deal.currency,
      propertyId: property.id,
      propertyCode: property.code,
      propertyTitle: property.title,
      propertyType: property.type,
      clientName: contact.displayName,
      agentName: user.name,
    })
    .from(dealOffer)
    .innerJoin(deal, eq(deal.id, dealOffer.dealId))
    .innerJoin(property, eq(property.id, deal.propertyId))
    .innerJoin(contact, eq(contact.id, deal.clientContactId))
    .leftJoin(user, eq(user.id, deal.assignedUserId))
    .where(and(...conditions))
    .orderBy(sql`case when ${dealOffer.status} = 'pending' then 0 else 1 end`, desc(dealOffer.createdAt))
    .limit(200);
  return rows.map((r) => ({
    ...r.o,
    dealCode: r.dealCode,
    dealStage: r.dealStage,
    operation: r.operation,
    propertyId: r.propertyId,
    propertyCode: r.propertyCode,
    propertyLabel: propertyDisplayTitle({
      title: r.propertyTitle,
      type: r.propertyType,
      code: r.propertyCode,
    }),
    clientName: r.clientName,
    agentName: r.agentName,
  }));
}

// ---------------------------------------------------------------------------------------------
// Reservas
// ---------------------------------------------------------------------------------------------

export async function createReservation(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(createReservationSchema, rawInput);
  return db.transaction(async (tx) => {
    const d = await loadDealForWrite(tx, ctx, input.dealId);
    requirePermission(ctx, "reservation.manage", dealRef(d));
    if (d.stage !== "negotiation" && d.stage !== "reserved")
      throw new ConflictError("Solo se reserva una operación en negociación");
    if (await activeReservation(tx, d.id))
      throw new ConflictError("La operación ya tiene una reserva vigente");
    if (await pendingOffer(tx, d.id))
      throw new ConflictError("Hay una oferta sin responder: aceptala o rechazala antes de reservar");
    const [row] = await tx
      .insert(dealReservation)
      .values({
        organizationId: ctx.organizationId,
        dealId: d.id,
        currency: input.currency,
        depositMinor: input.depositMinor,
        receivedAt: input.receivedAt,
        expiresAt: input.expiresAt,
        holder: input.holder,
        receiptNumber: input.receiptNumber,
        notes: input.notes,
        signingDate: input.signingDate,
        boletoSignedAt: input.boletoSignedAt,
        boletoExpiresAt: input.boletoExpiresAt,
        shared: input.shared,
        sharedWith: input.sharedWith,
        buyerNotary: input.buyerNotary,
        sellerNotary: input.sellerNotary,
        createdById: ctx.userId,
      })
      .returning();
    if (!row) throw new Error("No se pudo registrar la reserva");
    const note =
      input.depositMinor > 0n
        ? `Seña ${fmt(input.depositMinor, input.currency)} hasta ${fmtDate(input.expiresAt)}`
        : `Reserva sin seña hasta ${fmtDate(input.expiresAt)}`;
    if (d.stage === "negotiation") await applyDealStage(tx, ctx, d, { stage: "reserved", note });
    else
      await logActivity(tx, ctx, {
        type: "offer",
        contactId: d.clientContactId,
        leadId: d.leadId,
        body: `${d.code}: ${note}`,
        payload: { dealId: d.id, reservationId: row.id },
      });
    await writeAudit(tx, ctx, {
      action: "reservation.create",
      entityType: "deal",
      entityId: d.id,
      after: row,
    });
    await emitEvent(tx, ctx, {
      type: "reservation.created",
      aggregateType: "deal",
      aggregateId: d.id,
      payload: { reservationId: row.id, expiresAt: input.expiresAt, holder: input.holder },
    });
    return row;
  });
}

async function loadReservationForWrite(tx: DbOrTx, ctx: RequestContext, id: string) {
  const [r] = await tx
    .select()
    .from(dealReservation)
    .where(and(eq(dealReservation.id, id), eq(dealReservation.organizationId, ctx.organizationId)))
    .for("update");
  if (!r) throw new NotFoundError("Reserva");
  const d = await loadDealForWrite(tx, ctx, r.dealId);
  requirePermission(ctx, "reservation.manage", dealRef(d));
  if (r.status !== "active") throw new ConflictError("La reserva ya no está vigente");
  return { r, d };
}

/** Corrige los datos de una reserva vigente (seña, plazos, firma, escribanos, condiciones). */
export async function updateReservation(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(updateReservationSchema, rawInput);
  return db.transaction(async (tx) => {
    const { r, d } = await loadReservationForWrite(tx, ctx, input.reservationId);
    const [after] = await tx
      .update(dealReservation)
      .set({
        currency: input.currency,
        depositMinor: input.depositMinor,
        receivedAt: input.receivedAt,
        expiresAt: input.expiresAt,
        holder: input.holder,
        receiptNumber: input.receiptNumber,
        notes: input.notes,
        signingDate: input.signingDate,
        boletoSignedAt: input.boletoSignedAt,
        boletoExpiresAt: input.boletoExpiresAt,
        shared: input.shared,
        sharedWith: input.sharedWith,
        buyerNotary: input.buyerNotary,
        sellerNotary: input.sellerNotary,
        updatedAt: new Date(),
      })
      .where(eq(dealReservation.id, r.id))
      .returning();
    await writeAudit(tx, ctx, {
      action: "reservation.update",
      entityType: "deal",
      entityId: d.id,
      before: r,
      after,
    });
    return after;
  });
}

export async function extendReservation(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(extendReservationSchema, rawInput);
  return db.transaction(async (tx) => {
    const { r, d } = await loadReservationForWrite(tx, ctx, input.reservationId);
    if (input.expiresAt < r.receivedAt)
      throw new ValidationError("El vencimiento es anterior al cobro", { expiresAt: ["Fecha inválida"] });
    const [after] = await tx
      .update(dealReservation)
      .set({ expiresAt: input.expiresAt })
      .where(eq(dealReservation.id, r.id))
      .returning();
    await logActivity(tx, ctx, {
      type: "offer",
      contactId: d.clientContactId,
      leadId: d.leadId,
      body: `${d.code}: reserva prorrogada hasta ${fmtDate(input.expiresAt)}${input.note ? ` · ${input.note}` : ""}`,
      payload: { dealId: d.id, reservationId: r.id },
    });
    await writeAudit(tx, ctx, {
      action: "reservation.extend",
      entityType: "deal",
      entityId: d.id,
      before: { expiresAt: r.expiresAt },
      after: { expiresAt: input.expiresAt, note: input.note },
    });
    return after;
  });
}

/** Cancela la reserva: la seña se devuelve o se retiene, y la operación vuelve a negociación o se cae. */
export async function cancelReservation(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(cancelReservationSchema, rawInput);
  return db.transaction(async (tx) => {
    const { r, d } = await loadReservationForWrite(tx, ctx, input.reservationId);
    const [after] = await tx
      .update(dealReservation)
      .set({
        status: input.outcome,
        cancelReason: input.reason,
        refundedAt: input.outcome === "refunded" ? input.refundedAt : null,
        closedAt: new Date(),
      })
      .where(eq(dealReservation.id, r.id))
      .returning();
    const what = `${RESERVATION_STATUS_LABELS[input.outcome]} (${fmt(r.depositMinor, r.currency)}) · ${input.reason}`;
    if (d.stage === "reserved") {
      if (input.backToNegotiation) {
        requirePermission(ctx, "deal.manage", dealRef(d));
        await applyDealStage(tx, ctx, d, { stage: "negotiation", note: what });
      } else {
        await applyDealStage(tx, ctx, d, { stage: "fallen", fallenReason: input.reason, note: what });
      }
    }
    await writeAudit(tx, ctx, {
      action: "reservation.cancel",
      entityType: "deal",
      entityId: d.id,
      before: { status: r.status },
      after: { status: input.outcome, reason: input.reason, backToNegotiation: input.backToNegotiation },
    });
    await emitEvent(tx, ctx, {
      type: "reservation.cancelled",
      aggregateType: "deal",
      aggregateId: d.id,
      payload: { reservationId: r.id, outcome: input.outcome },
    });
    return after;
  });
}

/** Reservas en el alcance del usuario, con totales de señas vigentes por quién las tiene. */
export async function listReservations(
  db: DbOrTx,
  ctx: RequestContext,
  opts: { status?: "active" | "closed" | "all"; today: string; days?: number },
) {
  requirePermission(ctx, "reservation.read");
  const statusCond =
    opts.status === "active"
      ? eq(dealReservation.status, "active")
      : opts.status === "closed"
        ? inArray(dealReservation.status, ["converted", "refunded", "forfeited"] as ReservationStatus[])
        : undefined;
  const base = and(
    eq(dealReservation.organizationId, ctx.organizationId),
    isNull(deal.deletedAt),
    dealScope(ctx),
  );
  const rows = await db
    .select({
      r: dealReservation,
      dealCode: deal.code,
      dealStage: deal.stage,
      operation: deal.operation,
      priceMinor: deal.priceMinor,
      priceCurrency: deal.currency,
      propertyId: property.id,
      propertyCode: property.code,
      propertyTitle: property.title,
      propertyType: property.type,
      clientName: contact.displayName,
      agentName: user.name,
    })
    .from(dealReservation)
    .innerJoin(deal, eq(deal.id, dealReservation.dealId))
    .innerJoin(property, eq(property.id, deal.propertyId))
    .innerJoin(contact, eq(contact.id, deal.clientContactId))
    .leftJoin(user, eq(user.id, deal.assignedUserId))
    .where(and(base, statusCond))
    .orderBy(
      sql`case when ${dealReservation.status} = 'active' then 0 else 1 end`,
      asc(dealReservation.expiresAt),
    )
    .limit(300);

  const soon = new Date(`${opts.today}T12:00:00Z`);
  soon.setUTCDate(soon.getUTCDate() + (opts.days ?? 7));
  const soonYmd = soon.toISOString().slice(0, 10);
  const held: Record<string, Record<Currency, bigint>> = {};
  const active = await db
    .select({
      holder: dealReservation.holder,
      currency: dealReservation.currency,
      amount: dealReservation.depositMinor,
    })
    .from(dealReservation)
    .innerJoin(deal, eq(deal.id, dealReservation.dealId))
    .where(and(base, eq(dealReservation.status, "active")));
  const activeByCurrency: Record<Currency, number> = { USD: 0, UYU: 0 };
  for (const a of active) {
    activeByCurrency[a.currency] += 1;
    held[a.holder] ??= { USD: 0n, UYU: 0n };
    (held[a.holder] as Record<Currency, bigint>)[a.currency] += a.amount;
  }
  const [expiring] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(dealReservation)
    .innerJoin(deal, eq(deal.id, dealReservation.dealId))
    .where(and(base, eq(dealReservation.status, "active"), lte(dealReservation.expiresAt, soonYmd)));

  return {
    items: rows.map((x) => ({
      ...x.r,
      dealCode: x.dealCode,
      dealStage: x.dealStage,
      operation: x.operation,
      priceMinor: x.priceMinor,
      priceCurrency: x.priceCurrency,
      propertyId: x.propertyId,
      propertyCode: x.propertyCode,
      propertyLabel: propertyDisplayTitle({
        title: x.propertyTitle,
        type: x.propertyType,
        code: x.propertyCode,
      }),
      clientName: x.clientName,
      agentName: x.agentName,
      holderLabel: DEPOSIT_HOLDER_LABELS[x.r.holder],
    })),
    held,
    activeByCurrency,
    activeCount: active.length,
    expiringCount: expiring?.n ?? 0,
  };
}

/** Para el dashboard: reservas vigentes que vencen en los próximos días (o ya vencidas). */
export async function expiringReservations(db: DbOrTx, ctx: RequestContext, today: string, days = 7) {
  if (!hasPermission(ctx, "reservation.read")) return [];
  const limit = new Date(`${today}T12:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + days);
  const rows = await db
    .select({
      id: dealReservation.id,
      expiresAt: dealReservation.expiresAt,
      currency: dealReservation.currency,
      depositMinor: dealReservation.depositMinor,
      dealId: deal.id,
      dealCode: deal.code,
      clientName: contact.displayName,
    })
    .from(dealReservation)
    .innerJoin(deal, eq(deal.id, dealReservation.dealId))
    .innerJoin(contact, eq(contact.id, deal.clientContactId))
    .where(
      and(
        eq(dealReservation.organizationId, ctx.organizationId),
        eq(dealReservation.status, "active"),
        isNull(deal.deletedAt),
        dealScope(ctx),
        lte(dealReservation.expiresAt, limit.toISOString().slice(0, 10)),
      ),
    )
    .orderBy(asc(dealReservation.expiresAt));
  return rows;
}

/** Ofertas pendientes en el alcance (contador para el dashboard). */
export async function pendingOffersCount(db: DbOrTx, ctx: RequestContext, today: string) {
  if (!hasPermission(ctx, "offer.read")) return null;
  const base = and(
    eq(dealOffer.organizationId, ctx.organizationId),
    eq(dealOffer.status, "pending"),
    isNull(deal.deletedAt),
    dealScope(ctx),
  );
  const [[all], [expired]] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(dealOffer)
      .innerJoin(deal, eq(deal.id, dealOffer.dealId))
      .where(base),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(dealOffer)
      .innerJoin(deal, eq(deal.id, dealOffer.dealId))
      .where(and(base, sql`${dealOffer.validUntil} < ${today}`)),
  ]);
  return { pending: all?.n ?? 0, expired: expired?.n ?? 0 };
}
