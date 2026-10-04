import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, sql, type SQL } from "drizzle-orm";
import {
  contact,
  ownerSettlement,
  property,
  propertyOwner,
  rentCharge,
  rentChargeLine,
  rentPayment,
  rentalContract,
  rentalContractRent,
  user,
  type Db,
  type DbOrTx,
} from "@crm/db";
import {
  CHARGE_LINE_KIND_LABELS,
  PAYMENT_METHOD_LABELS,
  SETTLEMENT_STATUS_LABELS,
  chargeStatus,
  computeSettlement,
  diffDays,
  dueDateFor,
  formatMoney,
  lineSign,
  money,
  parseMoney,
  periodEnd,
  periodLabel,
  type ChargeStatus,
  type Currency,
} from "@crm/shared";
import {
  chargeLineSchema,
  chargeListSchema,
  createSettlementSchema,
  generateChargesSchema,
  registerPaymentSchema,
  settlementStatusSchema,
  voidPaymentSchema,
} from "@crm/shared/validation/billing";
import { uuidSchema } from "@crm/shared/validation";
import type { PermissionCode } from "@crm/shared/rbac";
import { scopeCondition } from "../access-filter";
import { writeAudit } from "../audit";
import { hasPermission, requirePermission, type RequestContext } from "../context";
import { logActivity } from "../crm/helpers";
import { ConflictError, NotFoundError, ValidationError, parseInput } from "../errors";
import { emitEvent } from "../events";
import { propertyDisplayTitle } from "../properties/helpers";
import { nextCode } from "../sequences";
import { contractRef } from "./contracts";

const fmt = (v: bigint, c: Currency) => formatMoney(money(v, c));
const toMinor = (v: string, c: Currency, field: string) => {
  try {
    const m = parseMoney(v, c).amountMinor;
    if (m <= 0n) throw new Error("no positivo");
    return m;
  } catch {
    throw new ValidationError("Importe inválido", { [field]: ["Importe inválido"] });
  }
};

function scopeFor(ctx: RequestContext, code: PermissionCode): SQL {
  return scopeCondition(ctx, code, {
    ownerUserId: rentalContract.assignedUserId,
    branchId: rentalContract.branchId,
    teamId: rentalContract.teamId,
  });
}

/** Alquiler vigente a una fecha según el historial del contrato. */
async function rentAt(tx: DbOrTx, contractId: string, ymd: string, fallback: bigint): Promise<bigint> {
  const [r] = await tx
    .select({ amount: rentalContractRent.amountMinor })
    .from(rentalContractRent)
    .where(and(eq(rentalContractRent.contractId, contractId), lte(rentalContractRent.effectiveFrom, ymd)))
    .orderBy(desc(rentalContractRent.effectiveFrom), desc(rentalContractRent.createdAt))
    .limit(1);
  return r?.amount ?? fallback;
}

/** Prorratea por días si el contrato empieza o termina dentro del mes; redondea a unidades. */
function prorate(
  amount: bigint,
  period: string,
  start: string,
  end: string,
): { amount: bigint; days: number | null } {
  const pEnd = periodEnd(period);
  const from = start > period ? start : period;
  const to = end < pEnd ? end : pEnd;
  const monthDays = diffDays(period, pEnd) + 1;
  const days = diffDays(from, to) + 1;
  if (days >= monthDays) return { amount, days: null };
  const raw = amount * BigInt(days);
  const units = (raw + BigInt(monthDays) * 50n) / (BigInt(monthDays) * 100n);
  return { amount: units * 100n, days };
}

/** Genera las cuotas del período para los contratos que lo cubren. Idempotente. */
export async function generateCharges(db: Db, ctx: RequestContext, rawInput: unknown) {
  requirePermission(ctx, "rent.manage");
  const { period } = parseInput(generateChargesSchema, rawInput);
  const pEnd = periodEnd(period);
  return db.transaction(async (tx) => {
    const contracts = await tx
      .select()
      .from(rentalContract)
      .where(
        and(
          eq(rentalContract.organizationId, ctx.organizationId),
          isNull(rentalContract.deletedAt),
          lte(rentalContract.startDate, pEnd),
          gte(rentalContract.endDate, period),
          or(eq(rentalContract.status, "active"), gte(rentalContract.closedAt, period)),
          // Una renovación cierra el contrato anterior en su vencimiento: no se cobra dos veces.
          ne(rentalContract.status, "renewed"),
          scopeFor(ctx, "rent.manage"),
        ),
      );
    const existing = contracts.length
      ? await tx
          .select({ contractId: rentCharge.contractId })
          .from(rentCharge)
          .where(
            and(
              eq(rentCharge.period, period),
              inArray(
                rentCharge.contractId,
                contracts.map((c) => c.id),
              ),
            ),
          )
      : [];
    let created = 0;
    for (const c of contracts) {
      if (existing.some((e) => e.contractId === c.id)) continue;
      const due = dueDateFor(period, c.paymentDay);
      const lastDay = c.closedAt && c.closedAt < c.endDate ? c.closedAt : c.endDate;
      const full = await rentAt(tx, c.id, due < c.startDate ? c.startDate : due, c.rentMinor);
      const { amount, days } = prorate(full, period, c.startDate, lastDay);
      if (amount <= 0n) continue;
      const [charge] = await tx
        .insert(rentCharge)
        .values({
          organizationId: ctx.organizationId,
          contractId: c.id,
          period,
          dueDate: due,
          currency: c.currency,
          createdById: ctx.userId,
        })
        .returning();
      if (!charge) continue;
      await tx.insert(rentChargeLine).values({
        organizationId: ctx.organizationId,
        chargeId: charge.id,
        kind: "rent",
        description: days
          ? `Alquiler ${periodLabel(period)} (${days} días)`
          : `Alquiler ${periodLabel(period)}`,
        amountMinor: amount,
        createdById: ctx.userId,
      });
      created += 1;
    }
    await writeAudit(tx, ctx, {
      action: "rent.generate",
      entityType: "organization",
      entityId: ctx.organizationId,
      after: { period, created, contracts: contracts.length },
    });
    return { created, skipped: contracts.length - created };
  });
}

async function loadChargeForWrite(tx: DbOrTx, ctx: RequestContext, chargeId: string, code: PermissionCode) {
  const [row] = await tx
    .select({ charge: rentCharge, contract: rentalContract })
    .from(rentCharge)
    .innerJoin(rentalContract, eq(rentalContract.id, rentCharge.contractId))
    .where(and(eq(rentCharge.id, chargeId), eq(rentCharge.organizationId, ctx.organizationId)))
    .for("update", { of: rentCharge });
  if (!row || !hasPermission(ctx, "rent.read", contractRef(row.contract))) throw new NotFoundError("Cuota");
  requirePermission(ctx, code, contractRef(row.contract));
  return row;
}

async function totals(tx: DbOrTx, chargeId: string) {
  const [lines, pays] = await Promise.all([
    tx.select().from(rentChargeLine).where(eq(rentChargeLine.chargeId, chargeId)),
    tx.select().from(rentPayment).where(eq(rentPayment.chargeId, chargeId)),
  ]);
  const total = lines.reduce((a, l) => a + l.amountMinor * lineSign(l.kind), 0n);
  const paid = pays.reduce((a, p) => a + p.amountMinor, 0n);
  return { lines, pays, total, paid };
}

async function activeSettlement(tx: DbOrTx, chargeId: string) {
  const [s] = await tx
    .select()
    .from(ownerSettlement)
    .where(and(eq(ownerSettlement.chargeId, chargeId), ne(ownerSettlement.status, "voided")));
  return s ?? null;
}

export async function addChargeLine(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(chargeLineSchema, rawInput);
  return db.transaction(async (tx) => {
    const { charge, contract } = await loadChargeForWrite(tx, ctx, input.chargeId, "rent.manage");
    const s = await activeSettlement(tx, charge.id);
    if (s && s.status !== "draft") throw new ConflictError("La cuota ya está liquidada al propietario");
    const amount = toMinor(input.amount, charge.currency, "amount");
    const { total } = await totals(tx, charge.id);
    if (input.kind === "discount" && amount > total)
      throw new ValidationError("La bonificación supera el total", { amount: ["Mayor al total"] });
    const [line] = await tx
      .insert(rentChargeLine)
      .values({
        organizationId: ctx.organizationId,
        chargeId: charge.id,
        kind: input.kind,
        description: input.description ?? CHARGE_LINE_KIND_LABELS[input.kind],
        amountMinor: amount,
        createdById: ctx.userId,
      })
      .returning();
    await writeAudit(tx, ctx, {
      action: "rent.line_add",
      entityType: "rent_charge",
      entityId: charge.id,
      after: { kind: input.kind, amountMinor: amount, contractId: contract.id },
    });
    return line;
  });
}

export async function registerPayment(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(registerPaymentSchema, rawInput);
  return db.transaction(async (tx) => {
    const { charge, contract } = await loadChargeForWrite(tx, ctx, input.chargeId, "payment.register");
    const amount = toMinor(input.amount, charge.currency, "amount");
    const { total, paid } = await totals(tx, charge.id);
    if (paid + amount > total)
      throw new ValidationError(`El pago supera el saldo (${fmt(total - paid, charge.currency)})`, {
        amount: ["Mayor al saldo"],
      });
    const [p] = await tx
      .insert(rentPayment)
      .values({
        organizationId: ctx.organizationId,
        chargeId: charge.id,
        amountMinor: amount,
        paidAt: input.paidAt,
        method: input.method,
        reference: input.reference,
        receivedById: ctx.userId,
      })
      .returning();
    await logActivity(tx, ctx, {
      type: "note",
      contactId: contract.tenantContactId,
      body: `Pago de alquiler ${contract.code} (${periodLabel(charge.period)}): ${fmt(amount, charge.currency)} · ${PAYMENT_METHOD_LABELS[input.method]}${paid + amount === total ? " · cuota saldada" : ""}`,
      payload: { chargeId: charge.id, paymentId: p?.id },
    });
    await writeAudit(tx, ctx, {
      action: "payment.register",
      entityType: "rent_charge",
      entityId: charge.id,
      after: p,
    });
    await emitEvent(tx, ctx, {
      type: "payment.registered",
      aggregateType: "rent_charge",
      aggregateId: charge.id,
      payload: { amountMinor: amount.toString(), currency: charge.currency },
    });
    return p;
  });
}

/** Anula un pago con un contra-asiento (el original no se toca). */
export async function voidPayment(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(voidPaymentSchema, rawInput);
  return db.transaction(async (tx) => {
    const [p] = await tx
      .select()
      .from(rentPayment)
      .where(and(eq(rentPayment.id, input.paymentId), eq(rentPayment.organizationId, ctx.organizationId)));
    if (!p) throw new NotFoundError("Pago");
    const { charge } = await loadChargeForWrite(tx, ctx, p.chargeId, "payment.void");
    if (p.voidsPaymentId) throw new ConflictError("Un contra-asiento no se anula");
    const [already] = await tx
      .select({ id: rentPayment.id })
      .from(rentPayment)
      .where(eq(rentPayment.voidsPaymentId, p.id));
    if (already) throw new ConflictError("El pago ya está anulado");
    if (await activeSettlement(tx, charge.id))
      throw new ConflictError("La cuota tiene una liquidación: anulala antes de anular el pago");
    const [v] = await tx
      .insert(rentPayment)
      .values({
        organizationId: ctx.organizationId,
        chargeId: charge.id,
        amountMinor: -p.amountMinor,
        paidAt: p.paidAt,
        method: p.method,
        reference: p.reference,
        voidsPaymentId: p.id,
        voidReason: input.reason,
        receivedById: ctx.userId,
      })
      .returning();
    await writeAudit(tx, ctx, {
      action: "payment.void",
      entityType: "rent_charge",
      entityId: charge.id,
      after: { paymentId: p.id, reason: input.reason },
    });
    return v;
  });
}

type ChargeRowOut = {
  id: string;
  contractId: string;
  contractCode: string;
  period: string;
  dueDate: string;
  currency: Currency;
  totalMinor: bigint;
  paidMinor: bigint;
  balanceMinor: bigint;
  status: ChargeStatus;
  daysLate: number;
  tenantContactId: string;
  tenantName: string;
  propertyId: string;
  propertyLabel: string;
  settlementId: string | null;
  settlementStatus: string | null;
};

async function chargeRows(
  db: DbOrTx,
  ctx: RequestContext,
  where: SQL | undefined,
  today: string,
): Promise<ChargeRowOut[]> {
  const rows = await db
    .select({
      c: rentCharge,
      contractCode: rentalContract.code,
      tenantContactId: rentalContract.tenantContactId,
      tenantName: contact.displayName,
      propertyId: property.id,
      propertyCode: property.code,
      propertyTitle: property.title,
      propertyType: property.type,
      propertyAddress: property.address,
      total: sql<string>`coalesce((select sum(case when l.kind = 'discount' then -l.amount_minor else l.amount_minor end) from rent_charge_line l where l.charge_id = "rent_charge"."id"), 0)`,
      paid: sql<string>`coalesce((select sum(p.amount_minor) from rent_payment p where p.charge_id = "rent_charge"."id"), 0)`,
      settlementId: sql<
        string | null
      >`(select s.id from owner_settlement s where s.charge_id = ${rentCharge.id} and s.status <> 'voided' limit 1)`,
      settlementStatus: sql<
        string | null
      >`(select s.status from owner_settlement s where s.charge_id = ${rentCharge.id} and s.status <> 'voided' limit 1)`,
    })
    .from(rentCharge)
    .innerJoin(rentalContract, eq(rentalContract.id, rentCharge.contractId))
    .innerJoin(contact, eq(contact.id, rentalContract.tenantContactId))
    .innerJoin(property, eq(property.id, rentalContract.propertyId))
    .where(and(eq(rentCharge.organizationId, ctx.organizationId), scopeFor(ctx, "rent.read"), where))
    .orderBy(asc(rentCharge.dueDate), asc(rentalContract.code))
    .limit(500);
  return rows.map((r) => {
    const total = BigInt(r.total);
    const paid = BigInt(r.paid);
    const status = chargeStatus(total, paid, r.c.dueDate, today);
    return {
      id: r.c.id,
      contractId: r.c.contractId,
      contractCode: r.contractCode,
      period: r.c.period,
      dueDate: r.c.dueDate,
      currency: r.c.currency,
      totalMinor: total,
      paidMinor: paid,
      balanceMinor: total - paid,
      status,
      daysLate: status === "overdue" ? diffDays(r.c.dueDate, today) : 0,
      tenantContactId: r.tenantContactId,
      tenantName: r.tenantName,
      propertyId: r.propertyId,
      propertyLabel:
        r.propertyAddress ||
        propertyDisplayTitle({ title: r.propertyTitle, type: r.propertyType, code: r.propertyCode }),
      settlementId: r.settlementId,
      settlementStatus: r.settlementStatus,
    };
  });
}

function sumBy(rows: ChargeRowOut[], pick: (r: ChargeRowOut) => bigint) {
  const out: Record<Currency, bigint> = { UYU: 0n, USD: 0n };
  for (const r of rows) out[r.currency] += pick(r);
  return out;
}

export async function listCharges(db: DbOrTx, ctx: RequestContext, rawQuery: unknown, today: string) {
  requirePermission(ctx, "rent.read");
  const q = parseInput(chargeListSchema, rawQuery);
  const conds: (SQL | undefined)[] = [
    q.period ? eq(rentCharge.period, q.period) : undefined,
    q.contractId ? eq(rentCharge.contractId, q.contractId) : undefined,
  ];
  let rows = await chargeRows(db, ctx, and(...conds), today);
  const all = rows;
  if (q.status === "open") rows = rows.filter((r) => r.status !== "paid");
  else if (q.status === "overdue") rows = rows.filter((r) => r.status === "overdue");
  else if (q.status === "paid") rows = rows.filter((r) => r.status === "paid");
  const overdue = all.filter((r) => r.status === "overdue");
  return {
    items: rows,
    totals: {
      due: sumBy(all, (r) => r.totalMinor),
      collected: sumBy(all, (r) => r.paidMinor),
      outstanding: sumBy(all, (r) => r.balanceMinor),
      overdue: sumBy(overdue, (r) => r.balanceMinor),
      overdueCount: overdue.length,
      count: all.length,
    },
    permissions: {
      generate: hasPermission(ctx, "rent.manage"),
      pay: hasPermission(ctx, "payment.register"),
      void: hasPermission(ctx, "payment.void"),
      settle: hasPermission(ctx, "settlement.manage"),
    },
  };
}

/** Morosidad de toda la cartera (cuotas vencidas con saldo), para el dashboard y la bandeja. */
export async function overdueCharges(db: DbOrTx, ctx: RequestContext, today: string) {
  if (!hasPermission(ctx, "rent.read")) return null;
  const rows = await chargeRows(db, ctx, lte(rentCharge.dueDate, today), today);
  const overdue = rows.filter((r) => r.status === "overdue");
  return { items: overdue, amount: sumBy(overdue, (r) => r.balanceMinor) };
}

export async function getCharge(db: DbOrTx, ctx: RequestContext, chargeId: string, today: string) {
  const id = parseInput(uuidSchema, chargeId);
  const [row] = await chargeRows(db, ctx, eq(rentCharge.id, id), today);
  if (!row) throw new NotFoundError("Cuota");
  const [lines, payments] = await Promise.all([
    db
      .select({ l: rentChargeLine, by: user.name })
      .from(rentChargeLine)
      .leftJoin(user, eq(user.id, rentChargeLine.createdById))
      .where(eq(rentChargeLine.chargeId, id))
      .orderBy(asc(rentChargeLine.createdAt)),
    db
      .select({ p: rentPayment, by: user.name })
      .from(rentPayment)
      .leftJoin(user, eq(user.id, rentPayment.receivedById))
      .where(eq(rentPayment.chargeId, id))
      .orderBy(asc(rentPayment.createdAt)),
  ]);
  const voided = new Set(payments.map((x) => x.p.voidsPaymentId).filter(Boolean));
  return {
    charge: row,
    lines: lines.map((x) => ({ ...x.l, createdByName: x.by })),
    payments: payments.map((x) => ({ ...x.p, receivedByName: x.by, voided: voided.has(x.p.id) })),
  };
}

// ---------------------------------------------------------------------------------------------
// Liquidaciones
// ---------------------------------------------------------------------------------------------

export async function createSettlement(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(createSettlementSchema, rawInput);
  return db.transaction(async (tx) => {
    const { charge, contract } = await loadChargeForWrite(tx, ctx, input.chargeId, "settlement.manage");
    if (await activeSettlement(tx, charge.id)) throw new ConflictError("La cuota ya tiene una liquidación");
    const { lines, paid } = await totals(tx, charge.id);
    if (paid <= 0n) throw new ConflictError("La cuota no tiene cobros para liquidar");
    const rentPortion = lines.reduce(
      (a, l) => a + (l.kind === "rent" ? l.amountMinor : l.kind === "discount" ? -l.amountMinor : 0n),
      0n,
    );
    const deductions = input.deductions.map((d) => ({
      description: d.description,
      amountMinor: toMinor(d.amount, charge.currency, "deductions"),
    }));
    const deductionsMinor = deductions.reduce((a, d) => a + d.amountMinor, 0n);
    const owners = await tx
      .select({
        contactId: propertyOwner.contactId,
        share: propertyOwner.shareBasisPoints,
        name: contact.displayName,
      })
      .from(propertyOwner)
      .innerJoin(contact, eq(contact.id, propertyOwner.contactId))
      .where(eq(propertyOwner.propertyId, contract.propertyId))
      .orderBy(desc(propertyOwner.shareBasisPoints));
    if (!owners.length) throw new ConflictError("La propiedad no tiene propietarios cargados");
    const calc = computeSettlement({
      currency: charge.currency,
      collectedMinor: paid,
      rentPortionMinor: rentPortion > 0n ? rentPortion : 0n,
      adminFeeBasisPoints: contract.adminFeeBasisPoints,
      deductionsMinor,
      owners: owners.map((o) => ({ contactId: o.contactId, shareBasisPoints: o.share })),
    });
    if (calc.netMinor < 0n)
      throw new ValidationError("Los descuentos superan lo cobrado", { deductions: ["Mayor a lo cobrado"] });
    const code = await nextCode(tx, ctx.organizationId, "LIQ");
    const [s] = await tx
      .insert(ownerSettlement)
      .values({
        organizationId: ctx.organizationId,
        code,
        contractId: contract.id,
        chargeId: charge.id,
        currency: charge.currency,
        incomeMinor: calc.incomeMinor,
        feeMinor: calc.feeMinor,
        deductionsMinor: calc.deductionsMinor,
        netMinor: calc.netMinor,
        deductions: deductions.map((d) => ({
          description: d.description,
          amountMinor: d.amountMinor.toString(),
        })),
        shares: calc.shares.map((sh) => ({
          contactId: sh.contactId,
          name: owners.find((o) => o.contactId === sh.contactId)?.name ?? "",
          shareBasisPoints: sh.shareBasisPoints,
          amountMinor: sh.amountMinor.toString(),
        })),
        notes: input.notes,
        createdById: ctx.userId,
      })
      .returning();
    if (!s) throw new Error("No se pudo crear la liquidación");
    await writeAudit(tx, ctx, {
      action: "settlement.create",
      entityType: "owner_settlement",
      entityId: s.id,
      after: s,
    });
    return s;
  });
}

export async function changeSettlementStatus(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(settlementStatusSchema, rawInput);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ s: ownerSettlement, contract: rentalContract })
      .from(ownerSettlement)
      .innerJoin(rentalContract, eq(rentalContract.id, ownerSettlement.contractId))
      .where(and(eq(ownerSettlement.id, input.id), eq(ownerSettlement.organizationId, ctx.organizationId)))
      .for("update", { of: ownerSettlement });
    if (!row || !hasPermission(ctx, "settlement.read", contractRef(row.contract)))
      throw new NotFoundError("Liquidación");
    requirePermission(ctx, "settlement.manage", contractRef(row.contract));
    const from = row.s.status;
    const ok =
      (input.status === "approved" && from === "draft") ||
      (input.status === "paid" && from === "approved") ||
      (input.status === "voided" && (from === "draft" || from === "approved"));
    if (!ok)
      throw new ConflictError(
        `No se puede pasar de ${SETTLEMENT_STATUS_LABELS[from]} a ${SETTLEMENT_STATUS_LABELS[input.status]}`,
      );
    if (input.status === "paid" && !input.paidAt)
      throw new ValidationError("Indicá la fecha de pago", { paidAt: ["Requerida"] });
    if (input.status === "voided" && !input.reason)
      throw new ValidationError("Indicá el motivo", { reason: ["Requerido"] });
    const [after] = await tx
      .update(ownerSettlement)
      .set({
        status: input.status,
        ...(input.status === "approved" ? { approvedById: ctx.userId, approvedAt: new Date() } : {}),
        ...(input.status === "paid" ? { paidAt: input.paidAt, reference: input.reference } : {}),
        ...(input.status === "voided" ? { voidReason: input.reason } : {}),
      })
      .where(eq(ownerSettlement.id, row.s.id))
      .returning();
    if (input.status === "paid")
      for (const sh of row.s.shares)
        await logActivity(tx, ctx, {
          type: "note",
          contactId: sh.contactId,
          body: `Liquidación ${row.s.code} pagada: ${fmt(BigInt(sh.amountMinor), row.s.currency)}${input.reference ? ` · ${input.reference}` : ""}`,
          payload: { settlementId: row.s.id },
        });
    await writeAudit(tx, ctx, {
      action: `settlement.${input.status}`,
      entityType: "owner_settlement",
      entityId: row.s.id,
      before: { status: from },
      after: { status: input.status, paidAt: input.paidAt, reference: input.reference, reason: input.reason },
    });
    await emitEvent(tx, ctx, {
      type: `settlement.${input.status}`,
      aggregateType: "owner_settlement",
      aggregateId: row.s.id,
      payload: { netMinor: row.s.netMinor.toString(), currency: row.s.currency },
    });
    return after;
  });
}

export async function listSettlements(
  db: DbOrTx,
  ctx: RequestContext,
  opts: { status?: "open" | "paid" | "all"; contractId?: string } = {},
) {
  requirePermission(ctx, "settlement.read");
  const rows = await db
    .select({
      s: ownerSettlement,
      contractCode: rentalContract.code,
      period: rentCharge.period,
      propertyCode: property.code,
      propertyTitle: property.title,
      propertyType: property.type,
      propertyAddress: property.address,
      tenantName: contact.displayName,
    })
    .from(ownerSettlement)
    .innerJoin(rentalContract, eq(rentalContract.id, ownerSettlement.contractId))
    .innerJoin(rentCharge, eq(rentCharge.id, ownerSettlement.chargeId))
    .innerJoin(property, eq(property.id, rentalContract.propertyId))
    .innerJoin(contact, eq(contact.id, rentalContract.tenantContactId))
    .where(
      and(
        eq(ownerSettlement.organizationId, ctx.organizationId),
        scopeCondition(ctx, "settlement.read", {
          ownerUserId: rentalContract.assignedUserId,
          branchId: rentalContract.branchId,
          teamId: rentalContract.teamId,
        }),
        opts.status === "open"
          ? inArray(ownerSettlement.status, ["draft", "approved"])
          : opts.status === "paid"
            ? eq(ownerSettlement.status, "paid")
            : undefined,
        opts.contractId ? eq(ownerSettlement.contractId, opts.contractId) : undefined,
      ),
    )
    .orderBy(
      sql`case ${ownerSettlement.status} when 'draft' then 0 when 'approved' then 1 when 'paid' then 2 else 3 end`,
      desc(rentCharge.period),
      desc(ownerSettlement.createdAt),
    )
    .limit(300);
  const items = rows.map((r) => ({
    ...r.s,
    contractCode: r.contractCode,
    period: r.period,
    propertyLabel:
      r.propertyAddress ||
      propertyDisplayTitle({ title: r.propertyTitle, type: r.propertyType, code: r.propertyCode }),
    tenantName: r.tenantName,
  }));
  const sum = (f: (i: (typeof items)[number]) => boolean, pick: (i: (typeof items)[number]) => bigint) => {
    const out: Record<Currency, bigint> = { UYU: 0n, USD: 0n };
    for (const i of items) if (f(i)) out[i.currency] += pick(i);
    return out;
  };
  return {
    items,
    totals: {
      toPay: sum(
        (i) => i.status === "draft" || i.status === "approved",
        (i) => i.netMinor,
      ),
      fees: sum(
        (i) => i.status !== "voided",
        (i) => i.feeMinor,
      ),
    },
    canManage: hasPermission(ctx, "settlement.manage"),
  };
}
