/**
 * Cobros de alquiler y liquidaciones a propietarios (Fase 9). Montos en unidad menor (bigint).
 */
import { allocate, money, percentage, type Currency } from "./money";

export const CHARGE_LINE_KINDS = [
  "rent",
  "common_expenses",
  "property_tax",
  "late_fee",
  "discount",
  "other",
] as const;
export type ChargeLineKind = (typeof CHARGE_LINE_KINDS)[number];
export const CHARGE_LINE_KIND_LABELS: Record<ChargeLineKind, string> = {
  rent: "Alquiler",
  common_expenses: "Gastos comunes",
  property_tax: "Contribución / impuestos",
  late_fee: "Recargo por mora",
  discount: "Bonificación",
  other: "Otro",
};
/** Las bonificaciones restan. */
export function lineSign(kind: ChargeLineKind): 1n | -1n {
  return kind === "discount" ? -1n : 1n;
}

export const PAYMENT_METHODS = ["transfer", "cash", "deposit", "check", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  transfer: "Transferencia",
  cash: "Efectivo",
  deposit: "Depósito bancario",
  check: "Cheque",
  other: "Otro",
};

export type ChargeStatus = "pending" | "partial" | "paid" | "overdue";
export const CHARGE_STATUS_LABELS: Record<ChargeStatus, string> = {
  pending: "Pendiente",
  partial: "Pago parcial",
  paid: "Pagado",
  overdue: "Vencido",
};

/** Estado de una cuota según lo cobrado y la fecha. */
export function chargeStatus(
  totalMinor: bigint,
  paidMinor: bigint,
  dueDate: string,
  today: string,
): ChargeStatus {
  if (paidMinor >= totalMinor) return "paid";
  if (dueDate < today) return "overdue";
  return paidMinor > 0n ? "partial" : "pending";
}

/** "2026-10" → primer día del período. */
export function periodStart(period: string): string {
  return `${period.slice(0, 7)}-01`;
}
export function periodLabel(periodYmd: string): string {
  const months = [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "setiembre",
    "octubre",
    "noviembre",
    "diciembre",
  ];
  return `${months[Number(periodYmd.slice(5, 7)) - 1]} ${periodYmd.slice(0, 4)}`;
}
export function periodEnd(periodYmd: string): string {
  const y = Number(periodYmd.slice(0, 4));
  const m = Number(periodYmd.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${periodYmd.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}
/** Vencimiento de la cuota: el día de pago del contrato dentro del período. */
export function dueDateFor(periodYmd: string, paymentDay: number): string {
  return `${periodYmd.slice(0, 7)}-${String(Math.min(Math.max(paymentDay, 1), 28)).padStart(2, "0")}`;
}
export function addPeriod(periodYmd: string, months: number): string {
  const y = Number(periodYmd.slice(0, 4));
  const m = Number(periodYmd.slice(5, 7)) - 1 + months;
  const d = new Date(Date.UTC(y, m, 1));
  return d.toISOString().slice(0, 10);
}

export const SETTLEMENT_STATUSES = ["draft", "approved", "paid", "voided"] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];
export const SETTLEMENT_STATUS_LABELS: Record<SettlementStatus, string> = {
  draft: "Borrador",
  approved: "Aprobada",
  paid: "Pagada al propietario",
  voided: "Anulada",
};

export const SETTLEMENT_LINE_KINDS = ["income", "admin_fee", "deduction"] as const;
export type SettlementLineKind = (typeof SETTLEMENT_LINE_KINDS)[number];
export const SETTLEMENT_LINE_KIND_LABELS: Record<SettlementLineKind, string> = {
  income: "Cobrado al inquilino",
  admin_fee: "Comisión de administración",
  deduction: "Descuento",
};

export interface SettlementCalc {
  incomeMinor: bigint;
  feeMinor: bigint;
  deductionsMinor: bigint;
  netMinor: bigint;
  shares: { contactId: string; shareBasisPoints: number; amountMinor: bigint }[];
}

/**
 * Liquidación: cobrado − comisión (sobre la parte de alquiler cobrada) − descuentos, repartido
 * entre propietarios por su participación (la suma de las partes es exactamente el neto).
 */
export function computeSettlement(input: {
  currency: Currency;
  collectedMinor: bigint;
  rentPortionMinor: bigint;
  adminFeeBasisPoints: number | null;
  deductionsMinor: bigint;
  owners: { contactId: string; shareBasisPoints: number }[];
}): SettlementCalc {
  const rentCollected =
    input.collectedMinor < input.rentPortionMinor ? input.collectedMinor : input.rentPortionMinor;
  const fee = input.adminFeeBasisPoints
    ? percentage(money(rentCollected, input.currency), input.adminFeeBasisPoints).amountMinor
    : 0n;
  const net = input.collectedMinor - fee - input.deductionsMinor;
  const owners = input.owners.filter((o) => o.shareBasisPoints > 0);
  const parts = owners.length
    ? allocate(
        money(net, input.currency),
        owners.map((o) => o.shareBasisPoints),
      )
    : [];
  return {
    incomeMinor: input.collectedMinor,
    feeMinor: fee,
    deductionsMinor: input.deductionsMinor,
    netMinor: net,
    shares: owners.map((o, i) => ({ ...o, amountMinor: parts[i]?.amountMinor ?? 0n })),
  };
}
