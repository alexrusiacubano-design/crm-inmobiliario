import { and, asc, desc, eq, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import {
  commissionSettings,
  commissionTier,
  contact,
  deal,
  dealCommission,
  dealOffer,
  dealParticipant,
  dealReservation,
  dealStageEvent,
  lead,
  locality,
  membership,
  neighborhood,
  property,
  user,
  type Db,
  type DbOrTx,
} from "@crm/db";
import {
  DEAL_STAGE_LABELS,
  OPEN_DEAL_STAGES,
  PROPERTY_OPERATION_LABELS,
  canTransitionDeal,
  formatMoney,
  money,
  normalizeText,
  parseMoney,
  parsePercentToBasisPoints,
  percentage,
  sidesFor,
  type Currency,
  type DealStage,
  type PropertyStatus,
} from "@crm/shared";
import {
  collectCommissionSchema,
  commissionTierSchema,
  createDealSchema,
  dealCommissionsSchema,
  dealListSchema,
  dealParticipantsSchema,
  dealStageSchema,
  updateDealSchema,
} from "@crm/shared/validation/deals";
import { uuidSchema } from "@crm/shared/validation";
import type { ResourceRef } from "@crm/shared/rbac";
import { scopeCondition } from "../access-filter";
import { writeAudit } from "../audit";
import { hasPermission, requirePermission, type RequestContext } from "../context";
import { contactRef, leadRef, logActivity, resolveAssignment, syncLeadSearch } from "../crm/helpers";
import { ConflictError, NotFoundError, ValidationError, parseInput } from "../errors";
import { emitEvent } from "../events";
import { propertyDisplayTitle, propertyRef, syncPropertySearch } from "../properties/helpers";
import { nextCode } from "../sequences";

export type DealRow = typeof deal.$inferSelect;

export function dealRef(
  d: Pick<DealRow, "organizationId" | "assignedUserId" | "branchId" | "teamId">,
): ResourceRef {
  return {
    organizationId: d.organizationId,
    ownerUserId: d.assignedUserId,
    branchId: d.branchId,
    teamId: d.teamId,
  };
}

const OFFERABLE: readonly PropertyStatus[] = ["available", "published", "negotiating", "reserved"];

export async function loadDealForWrite(tx: DbOrTx, ctx: RequestContext, id: string) {
  const [row] = await tx
    .select()
    .from(deal)
    .where(and(eq(deal.id, id), eq(deal.organizationId, ctx.organizationId), isNull(deal.deletedAt)))
    .for("update");
  if (!row || !hasPermission(ctx, "deal.read", dealRef(row))) throw new NotFoundError("Operación");
  return row;
}

/** Cambia el estado de la propiedad por la operación, dejando rastro en la auditoría. */
export async function setPropertyStatus(
  tx: DbOrTx,
  ctx: RequestContext,
  propertyId: string,
  status: PropertyStatus,
  reason: string,
) {
  const [p] = await tx.select().from(property).where(eq(property.id, propertyId));
  if (!p || p.status === status) return;
  await tx.update(property).set({ status, statusChangedAt: new Date() }).where(eq(property.id, propertyId));
  await writeAudit(tx, ctx, {
    action: "property.status_change",
    entityType: "property",
    entityId: propertyId,
    before: { status: p.status },
    after: { status, automatic: true, reason },
  });
  await syncPropertySearch(tx, [propertyId]);
}

// ---------------------------------------------------------------------------------------------
// Plan de carrera
// ---------------------------------------------------------------------------------------------

/** Escalones por defecto: valores de ejemplo que cada inmobiliaria ajusta en "Mi carrera". */
export const DEFAULT_TIERS = [
  { name: "Inicial", minBilledUsdMinor: 0n, rateBasisPoints: 4000 },
  { name: "Intermedio", minBilledUsdMinor: 1_000_000n, rateBasisPoints: 4500 },
  { name: "Avanzado", minBilledUsdMinor: 5_000_000n, rateBasisPoints: 5000 },
] as const;
const DEFAULT_UYU_PER_USD = "40";

export async function getCommissionPlan(db: DbOrTx, ctx: RequestContext) {
  const [tiers, [settings]] = await Promise.all([
    db
      .select()
      .from(commissionTier)
      .where(eq(commissionTier.organizationId, ctx.organizationId))
      .orderBy(asc(commissionTier.position)),
    db.select().from(commissionSettings).where(eq(commissionSettings.organizationId, ctx.organizationId)),
  ]);
  return {
    configured: tiers.length > 0,
    tiers: tiers.length
      ? tiers.map((t) => ({
          name: t.name,
          minBilledUsdMinor: t.minBilledUsdMinor,
          rateBasisPoints: t.rateBasisPoints,
        }))
      : DEFAULT_TIERS.map((t) => ({ ...t })),
    uyuPerUsd: settings?.uyuPerUsd ?? DEFAULT_UYU_PER_USD,
  };
}

export async function saveCommissionPlan(db: Db, ctx: RequestContext, rawInput: unknown) {
  requirePermission(ctx, "settings.manage");
  const input = parseInput(commissionTierSchema, rawInput);
  const tiers = input.tiers.map((t, i) => {
    try {
      return {
        position: i,
        name: t.name,
        minBilledUsdMinor: t.minBilled ? parseMoney(t.minBilled, "USD").amountMinor : 0n,
        rateBasisPoints: parsePercentToBasisPoints(t.rate),
      };
    } catch {
      throw new ValidationError("Revisá los importes y porcentajes", { [`tiers.${i}`]: ["Valor inválido"] });
    }
  });
  if (tiers[0]?.minBilledUsdMinor !== 0n)
    throw new ValidationError("El primer escalón empieza en 0", { "tiers.0": ["Debe empezar en 0"] });
  for (let i = 1; i < tiers.length; i++) {
    if ((tiers[i]?.minBilledUsdMinor ?? 0n) <= (tiers[i - 1]?.minBilledUsdMinor ?? 0n))
      throw new ValidationError("Cada escalón debe exigir más que el anterior", {
        [`tiers.${i}`]: ["Debe ser mayor"],
      });
  }
  const rate = input.uyuPerUsd.replace(",", ".");
  if (!/^\d{1,4}(\.\d{1,4})?$/.test(rate) || Number(rate) <= 0)
    throw new ValidationError("Tipo de cambio inválido", { uyuPerUsd: ["Inválido"] });
  return db.transaction(async (tx) => {
    const before = await getCommissionPlan(tx, ctx);
    await tx.delete(commissionTier).where(eq(commissionTier.organizationId, ctx.organizationId));
    await tx.insert(commissionTier).values(tiers.map((t) => ({ ...t, organizationId: ctx.organizationId })));
    await tx
      .insert(commissionSettings)
      .values({ organizationId: ctx.organizationId, uyuPerUsd: rate })
      .onConflictDoUpdate({ target: commissionSettings.organizationId, set: { uyuPerUsd: rate } });
    await writeAudit(tx, ctx, {
      action: "commission_plan.update",
      entityType: "organization",
      entityId: ctx.organizationId,
      before,
      after: { tiers, uyuPerUsd: rate },
    });
  });
}

type Plan = Awaited<ReturnType<typeof getCommissionPlan>>;

function toUsdMinor(amountMinor: bigint, currency: Currency, uyuPerUsd: string): bigint {
  if (currency === "USD") return amountMinor;
  // UYU → USD con 4 decimales de tipo de cambio, sin float.
  const [i = "0", f = ""] = uyuPerUsd.split(".");
  const rate = BigInt(i) * 10_000n + BigInt(f.padEnd(4, "0").slice(0, 4));
  return rate === 0n ? 0n : (amountMinor * 10_000n) / rate;
}

function tierFor(plan: Plan, billedUsdMinor: bigint) {
  let idx = 0;
  plan.tiers.forEach((t, i) => {
    if (billedUsdMinor >= t.minBilledUsdMinor) idx = i;
  });
  return { index: idx, tier: plan.tiers[idx], next: plan.tiers[idx + 1] ?? null };
}

/** Facturación acumulada de un agente: su parte de los honorarios cobrados, en USD. */
async function billedUsd(
  db: DbOrTx,
  ctx: RequestContext,
  userId: string,
  plan: Plan,
  excludeDealId?: string,
) {
  const rows = await db
    .select({
      currency: dealCommission.currency,
      amountMinor: dealCommission.amountMinor,
      share: dealParticipant.shareBasisPoints,
    })
    .from(dealParticipant)
    .innerJoin(dealCommission, eq(dealCommission.dealId, dealParticipant.dealId))
    .innerJoin(deal, eq(deal.id, dealParticipant.dealId))
    .where(
      and(
        eq(dealParticipant.organizationId, ctx.organizationId),
        eq(dealParticipant.userId, userId),
        eq(dealCommission.status, "collected"),
        isNull(deal.deletedAt),
        excludeDealId ? ne(deal.id, excludeDealId) : undefined,
      ),
    );
  return rows.reduce(
    (acc, r) =>
      acc +
      toUsdMinor(
        percentage(money(r.amountMinor, r.currency), r.share).amountMinor,
        r.currency,
        plan.uyuPerUsd,
      ),
    0n,
  );
}

async function snapshotRates(tx: DbOrTx, ctx: RequestContext, dealId: string) {
  const plan = await getCommissionPlan(tx, ctx);
  const parts = await tx.select().from(dealParticipant).where(eq(dealParticipant.dealId, dealId));
  for (const p of parts) {
    const billed = await billedUsd(tx, ctx, p.userId, plan, dealId);
    const { tier } = tierFor(plan, billed);
    await tx
      .update(dealParticipant)
      .set({ agentRateBasisPoints: tier?.rateBasisPoints ?? 0 })
      .where(and(eq(dealParticipant.dealId, dealId), eq(dealParticipant.userId, p.userId)));
  }
}

// ---------------------------------------------------------------------------------------------
// Operaciones
// ---------------------------------------------------------------------------------------------

export async function createDeal(db: Db, ctx: RequestContext, rawInput: unknown) {
  requirePermission(ctx, "deal.manage");
  const input = parseInput(createDealSchema, rawInput);
  return db.transaction(async (tx) => {
    const [p] = await tx
      .select()
      .from(property)
      .where(
        and(
          eq(property.id, input.propertyId),
          eq(property.organizationId, ctx.organizationId),
          isNull(property.deletedAt),
        ),
      )
      .for("update");
    if (!p || !hasPermission(ctx, "property.read", propertyRef(p))) throw new NotFoundError("Propiedad");
    if (!p.operations.includes(input.operation))
      throw new ValidationError(
        `La propiedad no se ofrece en ${PROPERTY_OPERATION_LABELS[input.operation].toLowerCase()}`,
        {
          operation: ["No corresponde a la propiedad"],
        },
      );
    if (!OFFERABLE.includes(p.status))
      throw new ConflictError("La propiedad no está disponible para una operación");

    const [c] = await tx
      .select()
      .from(contact)
      .where(
        and(
          eq(contact.id, input.clientContactId),
          eq(contact.organizationId, ctx.organizationId),
          isNull(contact.deletedAt),
        ),
      );
    if (
      !c ||
      (!hasPermission(ctx, "contact.read", contactRef(c)) && !hasPermission(ctx, "lead.read", contactRef(c)))
    )
      throw new NotFoundError("Cliente");
    if (input.leadId) {
      const [l] = await tx
        .select()
        .from(lead)
        .where(
          and(eq(lead.id, input.leadId), eq(lead.organizationId, ctx.organizationId), isNull(lead.deletedAt)),
        );
      if (!l || l.contactId !== c.id || !hasPermission(ctx, "lead.read", leadRef(l)))
        throw new ValidationError("El lead no corresponde al cliente", { leadId: ["Inválido"] });
    }

    const assignedUserId = input.assignedUserId ?? ctx.userId;
    const { branchId, teamId } = await resolveAssignment(tx, ctx.organizationId, assignedUserId);
    requirePermission(ctx, "deal.manage", {
      organizationId: ctx.organizationId,
      ownerUserId: assignedUserId,
      branchId,
      teamId,
    });

    const code = await nextCode(tx, ctx.organizationId, "OP");
    const [row] = await tx
      .insert(deal)
      .values({
        organizationId: ctx.organizationId,
        code,
        operation: input.operation,
        propertyId: p.id,
        clientContactId: c.id,
        leadId: input.leadId,
        currency: input.currency,
        priceMinor: input.priceMinor,
        expectedCloseDate: input.expectedCloseDate,
        notes: input.notes,
        assignedUserId,
        branchId,
        teamId,
        createdById: ctx.userId,
      })
      .returning();
    if (!row) throw new Error("No se pudo crear la operación");
    await tx.insert(dealStageEvent).values({
      organizationId: ctx.organizationId,
      dealId: row.id,
      fromStage: null,
      toStage: "negotiation",
      actorUserId: ctx.userId,
    });

    // Participantes por defecto: quien captó la propiedad y quien lleva la operación.
    const lister = p.captadorUserId ?? p.assignedUserId;
    const parts =
      lister && lister !== assignedUserId
        ? [
            { userId: lister, role: "lister" as const, shareBasisPoints: 5000 },
            { userId: assignedUserId, role: "seller_agent" as const, shareBasisPoints: 5000 },
          ]
        : [{ userId: assignedUserId, role: "seller_agent" as const, shareBasisPoints: 10_000 }];
    await tx
      .insert(dealParticipant)
      .values(parts.map((x) => ({ ...x, dealId: row.id, organizationId: ctx.organizationId })));

    // Honorario sugerido del propietario según la comisión pactada en la captación.
    if (p.commissionBasisPoints) {
      const fee = percentage(money(input.priceMinor, input.currency), p.commissionBasisPoints);
      if (fee.amountMinor > 0n) {
        const [ownerSide] = sidesFor(input.operation);
        await tx.insert(dealCommission).values({
          organizationId: ctx.organizationId,
          dealId: row.id,
          side: ownerSide ?? "seller",
          currency: input.currency,
          amountMinor: fee.amountMinor,
        });
      }
    }

    if (p.status === "available" || p.status === "published")
      await setPropertyStatus(tx, ctx, p.id, "negotiating", `Operación ${code}`);

    await logActivity(tx, ctx, {
      type: "offer",
      contactId: c.id,
      leadId: input.leadId,
      body: `Operación ${code} iniciada: ${propertyDisplayTitle(p)} · ${formatMoney(money(input.priceMinor, input.currency))}`,
      payload: { dealId: row.id, propertyId: p.id },
    });
    await writeAudit(tx, ctx, { action: "deal.create", entityType: "deal", entityId: row.id, after: row });
    await emitEvent(tx, ctx, {
      type: "deal.created",
      aggregateType: "deal",
      aggregateId: row.id,
      payload: { propertyId: p.id, clientContactId: c.id, operation: input.operation },
    });
    return row;
  });
}

export async function updateDeal(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(updateDealSchema, rawInput);
  return db.transaction(async (tx) => {
    const before = await loadDealForWrite(tx, ctx, input.id);
    requirePermission(ctx, "deal.manage", dealRef(before));
    if (!OPEN_DEAL_STAGES.includes(before.stage)) throw new ConflictError("La operación ya está cerrada");
    const [after] = await tx
      .update(deal)
      .set({
        currency: input.currency,
        priceMinor: input.priceMinor,
        expectedCloseDate: input.expectedCloseDate,
        notes: input.notes,
      })
      .where(eq(deal.id, before.id))
      .returning();
    await writeAudit(tx, ctx, {
      action: "deal.update",
      entityType: "deal",
      entityId: before.id,
      before,
      after,
    });
    return after;
  });
}

export async function changeDealStage(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(dealStageSchema, rawInput);
  return db.transaction(async (tx) => {
    const before = await loadDealForWrite(tx, ctx, input.id);
    requirePermission(ctx, input.stage === "closed" ? "deal.close" : "deal.manage", dealRef(before));
    // Con una seña vigente, volver atrás o caerse se hace cancelando la reserva (qué pasa con la seña).
    if (input.stage === "fallen" || input.stage === "negotiation") {
      const [active] = await tx
        .select({ id: dealReservation.id })
        .from(dealReservation)
        .where(and(eq(dealReservation.dealId, before.id), eq(dealReservation.status, "active")));
      if (active)
        throw new ConflictError(
          "La operación tiene una reserva vigente: cancelala indicando si la seña se devuelve o se retiene",
        );
    }
    return applyDealStage(tx, ctx, before, input);
  });
}

/**
 * Aplica un cambio de etapa ya autorizado (lo usan también reservas y ofertas dentro de su
 * transacción): valida la transición, mueve propiedad, lead, seña y ofertas, y deja rastro.
 */
export async function applyDealStage(
  tx: DbOrTx,
  ctx: RequestContext,
  before: DealRow,
  input: { stage: DealStage; closedAt?: string | null; fallenReason?: string | null; note?: string | null },
) {
  if (!canTransitionDeal(before.stage, input.stage))
    throw new ConflictError(
      `No se puede pasar de ${DEAL_STAGE_LABELS[before.stage]} a ${DEAL_STAGE_LABELS[input.stage]}`,
    );
  if (input.stage === "negotiation" && before.stage === "fallen") {
    const [p] = await tx.select().from(property).where(eq(property.id, before.propertyId));
    if (!p || !OFFERABLE.includes(p.status)) throw new ConflictError("La propiedad ya no está disponible");
  }

  const today = new Date().toISOString().slice(0, 10);
  const [after] = await tx
    .update(deal)
    .set({
      stage: input.stage,
      stageChangedAt: new Date(),
      closedAt: input.stage === "closed" ? (input.closedAt ?? today) : null,
      fallenReason: input.stage === "fallen" ? input.fallenReason : null,
    })
    .where(eq(deal.id, before.id))
    .returning();

  await tx.insert(dealStageEvent).values({
    organizationId: ctx.organizationId,
    dealId: before.id,
    fromStage: before.stage,
    toStage: input.stage,
    actorUserId: ctx.userId,
  });

  // Efectos sobre la propiedad y el lead.
  if (input.stage === "reserved")
    await setPropertyStatus(tx, ctx, before.propertyId, "reserved", before.code);
  if (input.stage === "closed") {
    if (before.operation === "sale") await setPropertyStatus(tx, ctx, before.propertyId, "sold", before.code);
    else if (before.operation === "rent")
      await setPropertyStatus(tx, ctx, before.propertyId, "rented", before.code);
    await snapshotRates(tx, ctx, before.id);
    if (before.leadId) {
      const [l] = await tx.select().from(lead).where(eq(lead.id, before.leadId));
      if (l && l.status !== "won" && l.status !== "lost") {
        await tx
          .update(lead)
          .set({ status: "won", statusChangedAt: new Date(), closedAt: new Date() })
          .where(eq(lead.id, l.id));
        await syncLeadSearch(tx, [l.id]);
        await logActivity(tx, ctx, {
          type: "lead_status_changed",
          contactId: l.contactId,
          leadId: l.id,
          payload: { from: l.status, to: "won", automatic: true, dealId: before.id },
        });
      }
    }
  }
  if (input.stage === "fallen") {
    const [others] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(deal)
      .where(
        and(
          eq(deal.propertyId, before.propertyId),
          ne(deal.id, before.id),
          isNull(deal.deletedAt),
          inArray(deal.stage, [...OPEN_DEAL_STAGES]),
        ),
      );
    const [p] = await tx.select().from(property).where(eq(property.id, before.propertyId));
    if ((others?.n ?? 0) === 0 && p && (p.status === "negotiating" || p.status === "reserved"))
      await setPropertyStatus(
        tx,
        ctx,
        p.id,
        p.publishedAt ? "published" : "available",
        `${before.code} se cayó`,
      );
    await tx
      .update(dealCommission)
      .set({ status: "cancelled" })
      .where(and(eq(dealCommission.dealId, before.id), eq(dealCommission.status, "pending")));
  }

  // La seña vigente pasa a boleto/contrato cuando la operación avanza.
  if (["notary", "signed", "closed"].includes(input.stage))
    await tx
      .update(dealReservation)
      .set({ status: "converted", closedAt: new Date() })
      .where(and(eq(dealReservation.dealId, before.id), eq(dealReservation.status, "active")));
  // Si se cae, las ofertas sin responder quedan retiradas.
  if (input.stage === "fallen")
    await tx
      .update(dealOffer)
      .set({
        status: "withdrawn",
        respondedAt: new Date(),
        respondedById: ctx.userId,
        responseNote: "La operación se cayó",
      })
      .where(and(eq(dealOffer.dealId, before.id), eq(dealOffer.status, "pending")));

  await logActivity(tx, ctx, {
    type: "offer",
    contactId: before.clientContactId,
    leadId: before.leadId,
    body: `${before.code}: ${DEAL_STAGE_LABELS[input.stage]}${input.fallenReason ? ` · ${input.fallenReason}` : ""}${input.note ? ` · ${input.note}` : ""}`,
    payload: { dealId: before.id, from: before.stage, to: input.stage },
  });
  await writeAudit(tx, ctx, {
    action: "deal.stage_change",
    entityType: "deal",
    entityId: before.id,
    before: { stage: before.stage },
    after: { stage: input.stage, fallenReason: input.fallenReason },
  });
  await emitEvent(tx, ctx, {
    type:
      input.stage === "closed"
        ? "deal.closed"
        : input.stage === "fallen"
          ? "deal.fallen"
          : "deal.stage_changed",
    aggregateType: "deal",
    aggregateId: before.id,
    payload: { from: before.stage, to: input.stage, propertyId: before.propertyId },
  });
  return after;
}

export async function setDealCommissions(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(dealCommissionsSchema, rawInput);
  return db.transaction(async (tx) => {
    const d = await loadDealForWrite(tx, ctx, input.dealId);
    if (!hasPermission(ctx, "commission.manage", dealRef(d)))
      requirePermission(ctx, "deal.manage", dealRef(d));
    if (d.stage === "fallen") throw new ConflictError("La operación se cayó");
    const allowed = sidesFor(d.operation);
    for (const l of input.lines)
      if (!allowed.includes(l.side))
        throw new ValidationError("Parte inválida para esta operación", { lines: ["Parte inválida"] });

    const existing = await tx.select().from(dealCommission).where(eq(dealCommission.dealId, d.id));
    for (const e of existing.filter((x) => x.status === "collected")) {
      const next = input.lines.find((l) => l.side === e.side);
      if (!next || next.amountMinor !== e.amountMinor || next.currency !== e.currency)
        throw new ConflictError("Un honorario cobrado no se modifica");
    }
    await tx
      .delete(dealCommission)
      .where(and(eq(dealCommission.dealId, d.id), ne(dealCommission.status, "collected")));
    const toInsert = input.lines.filter(
      (l) => !existing.some((e) => e.side === l.side && e.status === "collected"),
    );
    if (toInsert.length)
      await tx.insert(dealCommission).values(
        toInsert.map((l) => ({
          organizationId: ctx.organizationId,
          dealId: d.id,
          side: l.side,
          currency: l.currency,
          amountMinor: l.amountMinor,
          dueDate: l.dueDate,
        })),
      );
    await writeAudit(tx, ctx, {
      action: "deal.commissions_set",
      entityType: "deal",
      entityId: d.id,
      before: existing,
      after: input.lines,
    });
  });
}

export async function collectCommission(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(collectCommissionSchema, rawInput);
  return db.transaction(async (tx) => {
    const [c] = await tx
      .select()
      .from(dealCommission)
      .where(
        and(eq(dealCommission.id, input.commissionId), eq(dealCommission.organizationId, ctx.organizationId)),
      )
      .for("update");
    if (!c) throw new NotFoundError("Honorario");
    const d = await loadDealForWrite(tx, ctx, c.dealId);
    requirePermission(ctx, "commission.manage", dealRef(d));
    if (c.status !== "pending") throw new ConflictError("El honorario no está pendiente");
    await tx
      .update(dealCommission)
      .set({
        status: "collected",
        collectedAt: input.collectedAt,
        reference: input.reference,
        collectedById: ctx.userId,
      })
      .where(eq(dealCommission.id, c.id));
    await writeAudit(tx, ctx, {
      action: "commission.collect",
      entityType: "deal",
      entityId: d.id,
      before: { status: c.status },
      after: { commissionId: c.id, collectedAt: input.collectedAt, reference: input.reference },
    });
    await emitEvent(tx, ctx, {
      type: "commission.collected",
      aggregateType: "deal",
      aggregateId: d.id,
      payload: { commissionId: c.id, amountMinor: c.amountMinor.toString(), currency: c.currency },
    });
  });
}

export async function setDealParticipants(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(dealParticipantsSchema, rawInput);
  return db.transaction(async (tx) => {
    const d = await loadDealForWrite(tx, ctx, input.dealId);
    if (!hasPermission(ctx, "commission.manage", dealRef(d)))
      requirePermission(ctx, "deal.manage", dealRef(d));
    const members = await tx
      .select({ userId: membership.userId })
      .from(membership)
      .where(
        and(
          eq(membership.organizationId, ctx.organizationId),
          eq(membership.status, "active"),
          inArray(
            membership.userId,
            input.participants.map((p) => p.userId),
          ),
        ),
      );
    if (members.length !== input.participants.length)
      throw new ValidationError("Hay participantes que no son usuarios activos", {
        participants: ["Usuario inválido"],
      });
    const before = await tx.select().from(dealParticipant).where(eq(dealParticipant.dealId, d.id));
    await tx.delete(dealParticipant).where(eq(dealParticipant.dealId, d.id));
    await tx
      .insert(dealParticipant)
      .values(input.participants.map((p) => ({ ...p, dealId: d.id, organizationId: ctx.organizationId })));
    if (d.stage === "closed") await snapshotRates(tx, ctx, d.id);
    await writeAudit(tx, ctx, {
      action: "deal.participants_set",
      entityType: "deal",
      entityId: d.id,
      before,
      after: input.participants,
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Lecturas
// ---------------------------------------------------------------------------------------------

export function dealScope(ctx: RequestContext): SQL {
  const own = scopeCondition(ctx, "deal.read", {
    ownerUserId: deal.assignedUserId,
    branchId: deal.branchId,
    teamId: deal.teamId,
  });
  // Un agente también ve las operaciones donde participa (p. ej. como captador).
  return sql`(${own} or exists (select 1 from deal_participant dp where dp.deal_id = ${deal.id} and dp.user_id = ${ctx.userId}))`;
}

export async function listDeals(db: DbOrTx, ctx: RequestContext, rawQuery: unknown) {
  requirePermission(ctx, "deal.read");
  const q = parseInput(dealListSchema, rawQuery);
  const conditions: (SQL | undefined)[] = [
    eq(deal.organizationId, ctx.organizationId),
    isNull(deal.deletedAt),
    dealScope(ctx),
  ];
  if (q.status === "open") conditions.push(inArray(deal.stage, [...OPEN_DEAL_STAGES]));
  else if (q.status === "closed") conditions.push(eq(deal.stage, "closed"));
  else if (q.status === "fallen") conditions.push(eq(deal.stage, "fallen"));
  if (q.operation) conditions.push(eq(deal.operation, q.operation));
  if (q.mine)
    conditions.push(
      or(
        eq(deal.assignedUserId, ctx.userId),
        sql`exists (select 1 from deal_participant dp where dp.deal_id = ${deal.id} and dp.user_id = ${ctx.userId})`,
      ),
    );
  if (q.q) {
    const term = `%${normalizeText(q.q)}%`;
    conditions.push(
      sql`(lower(${deal.code}) like ${term} or lower(${property.code}) like ${term} or lower(unaccent(coalesce(${property.title}, ''))) like ${term} or lower(unaccent(${contact.displayName})) like ${term})`,
    );
  }
  const where = and(...conditions);
  const baseCounts = and(eq(deal.organizationId, ctx.organizationId), isNull(deal.deletedAt), dealScope(ctx));
  const [rows, [total], counts] = await Promise.all([
    db
      .select({
        d: deal,
        propertyCode: property.code,
        propertyTitle: property.title,
        propertyType: property.type,
        propertyAddress: property.address,
        zone: sql<string | null>`nullif(concat_ws(', ', ${neighborhood.name}, ${locality.name}), '')`,
        clientName: contact.displayName,
        assignedName: user.name,
      })
      .from(deal)
      .innerJoin(property, eq(property.id, deal.propertyId))
      .innerJoin(contact, eq(contact.id, deal.clientContactId))
      .leftJoin(user, eq(user.id, deal.assignedUserId))
      .leftJoin(locality, eq(locality.id, property.localityId))
      .leftJoin(neighborhood, eq(neighborhood.id, property.neighborhoodId))
      .where(where)
      .orderBy(desc(deal.stageChangedAt))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(deal)
      .innerJoin(property, eq(property.id, deal.propertyId))
      .innerJoin(contact, eq(contact.id, deal.clientContactId))
      .where(where),
    db
      .select({ stage: deal.stage, operation: deal.operation, n: sql<number>`count(*)::int` })
      .from(deal)
      .where(baseCounts)
      .groupBy(deal.stage, deal.operation),
  ]);
  const ids = rows.map((r) => r.d.id);
  const commissions = ids.length
    ? await db.select().from(dealCommission).where(inArray(dealCommission.dealId, ids))
    : [];
  return {
    items: rows.map((r) => ({
      ...r.d,
      propertyLabel: propertyDisplayTitle({
        title: r.propertyTitle,
        type: r.propertyType,
        code: r.propertyCode,
      }),
      propertyCode: r.propertyCode,
      propertyAddress: r.propertyAddress,
      zone: r.zone,
      clientName: r.clientName,
      assignedName: r.assignedName,
      commissions: commissions.filter((c) => c.dealId === r.d.id),
    })),
    total: total?.n ?? 0,
    page: q.page,
    pageSize: q.pageSize,
    counts,
  };
}

export async function getDeal(db: DbOrTx, ctx: RequestContext, dealId: string) {
  const id = parseInput(uuidSchema, dealId);
  const [row] = await db
    .select({
      d: deal,
      p: property,
      clientName: contact.displayName,
      assignedName: user.name,
      zone: sql<string | null>`nullif(concat_ws(', ', ${neighborhood.name}, ${locality.name}), '')`,
    })
    .from(deal)
    .innerJoin(property, eq(property.id, deal.propertyId))
    .innerJoin(contact, eq(contact.id, deal.clientContactId))
    .leftJoin(user, eq(user.id, deal.assignedUserId))
    .leftJoin(locality, eq(locality.id, property.localityId))
    .leftJoin(neighborhood, eq(neighborhood.id, property.neighborhoodId))
    .where(and(eq(deal.id, id), eq(deal.organizationId, ctx.organizationId), isNull(deal.deletedAt)));
  if (!row) throw new NotFoundError("Operación");
  const ref = dealRef(row.d);
  const [participants, commissions, leadRow] = await Promise.all([
    db
      .select({ p: dealParticipant, name: user.name })
      .from(dealParticipant)
      .innerJoin(user, eq(user.id, dealParticipant.userId))
      .where(eq(dealParticipant.dealId, id))
      .orderBy(desc(dealParticipant.shareBasisPoints)),
    db.select().from(dealCommission).where(eq(dealCommission.dealId, id)).orderBy(asc(dealCommission.side)),
    row.d.leadId
      ? db.select({ code: lead.code }).from(lead).where(eq(lead.id, row.d.leadId))
      : Promise.resolve([]),
  ]);
  const participates = participants.some((x) => x.p.userId === ctx.userId);
  if (!hasPermission(ctx, "deal.read", ref) && !participates) throw new NotFoundError("Operación");
  const canSeeMoney = hasPermission(ctx, "commission.read", ref) || participates;
  return {
    deal: row.d,
    property: {
      id: row.p.id,
      code: row.p.code,
      label: propertyDisplayTitle(row.p),
      address: row.p.address,
      zone: row.zone,
      status: row.p.status,
    },
    clientName: row.clientName,
    leadCode: leadRow[0]?.code ?? null,
    assignedName: row.assignedName,
    participants: participants.map((x) => ({ ...x.p, name: x.name })),
    commissions: canSeeMoney ? commissions : [],
    permissions: {
      manage: hasPermission(ctx, "deal.manage", ref),
      close: hasPermission(ctx, "deal.close", ref),
      commissions: hasPermission(ctx, "commission.manage", ref) || hasPermission(ctx, "deal.manage", ref),
      collect: hasPermission(ctx, "commission.manage", ref),
      seeMoney: canSeeMoney,
    },
  };
}

/** Operaciones abiertas de una propiedad (para mostrar en su ficha). */
export async function dealsForProperty(db: DbOrTx, ctx: RequestContext, propertyId: string) {
  if (!hasPermission(ctx, "deal.read")) return [];
  return db
    .select({
      id: deal.id,
      code: deal.code,
      stage: deal.stage,
      operation: deal.operation,
      clientName: contact.displayName,
    })
    .from(deal)
    .innerJoin(contact, eq(contact.id, deal.clientContactId))
    .where(
      and(
        eq(deal.organizationId, ctx.organizationId),
        eq(deal.propertyId, parseInput(uuidSchema, propertyId)),
        isNull(deal.deletedAt),
        dealScope(ctx),
      ),
    )
    .orderBy(desc(deal.createdAt));
}

// ---------------------------------------------------------------------------------------------
// Finanzas del agente y carrera
// ---------------------------------------------------------------------------------------------

async function userRef(db: DbOrTx, ctx: RequestContext, userId: string): Promise<ResourceRef> {
  const { branchId, teamId } = await resolveAssignment(db, ctx.organizationId, userId);
  return { organizationId: ctx.organizationId, ownerUserId: userId, branchId, teamId };
}

/**
 * Lo que le corresponde a un agente por cada honorario de las operaciones donde participa:
 * honorario × su parte × su porcentaje (el del escalón al cerrar, o el actual si sigue abierta).
 */
export async function agentFinance(
  db: DbOrTx,
  ctx: RequestContext,
  opts: { userId?: string; today: string },
) {
  const userId = opts.userId ?? ctx.userId;
  requirePermission(ctx, "commission.read", await userRef(db, ctx, userId));
  const plan = await getCommissionPlan(db, ctx);
  const currentRate = tierFor(plan, await billedUsd(db, ctx, userId, plan)).tier?.rateBasisPoints ?? 0;

  const rows = await db
    .select({
      c: dealCommission,
      share: dealParticipant.shareBasisPoints,
      rate: dealParticipant.agentRateBasisPoints,
      dealId: deal.id,
      dealCode: deal.code,
      stage: deal.stage,
      operation: deal.operation,
      propertyTitle: property.title,
      propertyType: property.type,
      propertyCode: property.code,
      participants: sql<number>`(select count(*)::int from deal_participant x where x.deal_id = ${deal.id})`,
      sides: sql<number>`(select count(*)::int from deal_commission y where y.deal_id = ${deal.id} and y.status <> 'cancelled')`,
    })
    .from(dealParticipant)
    .innerJoin(deal, eq(deal.id, dealParticipant.dealId))
    .innerJoin(dealCommission, eq(dealCommission.dealId, deal.id))
    .innerJoin(property, eq(property.id, deal.propertyId))
    .where(
      and(
        eq(dealParticipant.organizationId, ctx.organizationId),
        eq(dealParticipant.userId, userId),
        isNull(deal.deletedAt),
        ne(dealCommission.status, "cancelled"),
      ),
    )
    .orderBy(
      desc(
        sql`coalesce(${dealCommission.collectedAt}, ${dealCommission.dueDate}, ${deal.expectedCloseDate})`,
      ),
    );

  const lines = rows.map((r) => {
    const rate = r.rate ?? currentRate;
    const mine = percentage(percentage(money(r.c.amountMinor, r.c.currency), r.share), rate);
    return {
      id: r.c.id,
      dealId: r.dealId,
      dealCode: r.dealCode,
      stage: r.stage as DealStage,
      operation: r.operation,
      title: propertyDisplayTitle({ title: r.propertyTitle, type: r.propertyType, code: r.propertyCode }),
      side: r.c.side,
      status: r.c.status,
      currency: r.c.currency,
      amountMinor: mine.amountMinor,
      date: r.c.collectedAt ?? r.c.dueDate,
      teamWork: r.participants > 1,
      bothSides: r.sides > 1,
      rateBasisPoints: rate,
      shareBasisPoints: r.share,
    };
  });

  const month = opts.today.slice(0, 7);
  const year = opts.today.slice(0, 4);
  const totals = (filter: (l: (typeof lines)[number]) => boolean) => {
    const out: Record<Currency, bigint> = { USD: 0n, UYU: 0n };
    for (const l of lines) if (filter(l)) out[l.currency] += l.amountMinor;
    return out;
  };
  const collected = (l: (typeof lines)[number]) => l.status === "collected";
  const months: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const [y, m] = opts.today.split("-").map(Number);
    const d = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1 - i, 1));
    months.push(d.toISOString().slice(0, 7));
  }
  const nextDue = lines
    .filter((l) => l.status === "pending" && l.stage !== "fallen")
    .sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"))[0];

  return {
    userId,
    lines,
    collectedTotal: totals(collected),
    collectedMonth: totals((l) => collected(l) && (l.date ?? "").startsWith(month)),
    collectedYear: totals((l) => collected(l) && (l.date ?? "").startsWith(year)),
    collectedYearCount: new Set(
      lines.filter((l) => collected(l) && (l.date ?? "").startsWith(year)).map((l) => l.dealId),
    ).size,
    pending: totals((l) => l.status === "pending"),
    nextDue: nextDue ?? null,
    monthly: months.map((m) => ({
      month: m,
      ...totals((l) => collected(l) && (l.date ?? "").startsWith(m)),
    })),
    currentRateBasisPoints: currentRate,
  };
}

export async function careerStatus(db: DbOrTx, ctx: RequestContext, userId = ctx.userId) {
  requirePermission(ctx, "commission.read", await userRef(db, ctx, userId));
  const plan = await getCommissionPlan(db, ctx);
  const billed = await billedUsd(db, ctx, userId, plan);
  const { index, tier, next } = tierFor(plan, billed);
  return {
    plan,
    billedUsdMinor: billed,
    tierIndex: index,
    tier,
    next,
    remainingUsdMinor: next ? next.minBilledUsdMinor - billed : 0n,
    canEditPlan: hasPermission(ctx, "settings.manage"),
  };
}

/** Personas que pueden participar en operaciones (para el editor de reparto). */
export async function listDealUsers(db: DbOrTx, ctx: RequestContext) {
  requirePermission(ctx, "deal.read");
  return db
    .select({ userId: user.id, name: user.name })
    .from(membership)
    .innerJoin(user, eq(user.id, membership.userId))
    .where(and(eq(membership.organizationId, ctx.organizationId), eq(membership.status, "active")))
    .orderBy(asc(user.name));
}
