/**
 * Contratos de alquiler (Fase 7): plazo, alquiler vigente, ajustes periódicos, renovaciones y
 * rescisiones. Las fechas son ISO sin hora ("2026-03-01").
 */

export const CONTRACT_STATUSES = ["active", "ended", "terminated", "renewed"] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];
export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  active: "Vigente",
  ended: "Finalizado",
  terminated: "Rescindido",
  renewed: "Renovado",
};

export const ADJUSTMENT_INDEXES = ["ipc", "ui", "fixed", "none"] as const;
export type AdjustmentIndex = (typeof ADJUSTMENT_INDEXES)[number];
export const ADJUSTMENT_INDEX_LABELS: Record<AdjustmentIndex, string> = {
  ipc: "IPC (variación de precios)",
  ui: "Unidades Indexadas",
  fixed: "Porcentaje fijo",
  none: "Sin ajuste",
};

export const RENT_CHANGE_REASONS = ["initial", "adjustment", "renewal", "agreement"] as const;
export type RentChangeReason = (typeof RENT_CHANGE_REASONS)[number];
export const RENT_CHANGE_REASON_LABELS: Record<RentChangeReason, string> = {
  initial: "Alquiler inicial",
  adjustment: "Ajuste",
  renewal: "Renovación",
  agreement: "Acuerdo entre partes",
};

export const CONTRACT_CLOSE_KINDS = ["ended", "terminated"] as const;
export type ContractCloseKind = (typeof CONTRACT_CLOSE_KINDS)[number];

/** Días de anticipación de los avisos. */
export const CONTRACT_EXPIRY_ALERT_DAYS = 90;
export const ADJUSTMENT_ALERT_DAYS = 30;

function parts(ymd: string): [number, number, number] {
  return [Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)), Number(ymd.slice(8, 10))];
}
function fmt(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Suma meses respetando fin de mes (31/01 + 1 mes = 28 o 29/02). */
export function addMonths(ymd: string, months: number): string {
  const [y, m, d] = parts(ymd);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return fmt(ny, nm, Math.min(d, last));
}

export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = parts(ymd);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Fin de un contrato de N meses que empieza en `start` (el día anterior al aniversario). */
export function contractEnd(start: string, months: number): string {
  return addDaysYmd(addMonths(start, months), -1);
}

export function diffDays(from: string, to: string): number {
  const [a1, a2, a3] = parts(from);
  const [b1, b2, b3] = parts(to);
  return Math.round((Date.UTC(b1, b2 - 1, b3) - Date.UTC(a1, a2 - 1, a3)) / 86_400_000);
}

/** Primer ajuste: `months` después del inicio (null si no ajusta o cae después del fin). */
export function firstAdjustment(
  start: string,
  end: string,
  index: AdjustmentIndex,
  months: number,
): string | null {
  if (index === "none" || months <= 0) return null;
  const next = addMonths(start, months);
  return next <= end ? next : null;
}

/** Próximo ajuste después de aplicar uno. */
export function nextAdjustmentAfter(current: string, end: string, months: number): string | null {
  const next = addMonths(current, months);
  return next <= end ? next : null;
}

/**
 * Aplica un porcentaje (basis points, puede ser negativo) y redondea a unidades enteras
 * (sin centésimos), mitad hacia arriba.
 */
export function adjustRent(amountMinor: bigint, basisPoints: number): bigint {
  const raw = amountMinor * BigInt(10_000 + basisPoints);
  const units = (raw + 500_000n) / 1_000_000n; // /10_000 (bp) /100 (centésimos), redondeado
  return units * 100n;
}

/** Basis points que representa pasar de `from` a `to` (redondeado). */
export function changeBasisPoints(from: bigint, to: bigint): number {
  if (from <= 0n) return 0;
  const diff = (to - from) * 20_000n;
  const half = diff >= 0n ? from : -from;
  return Number((diff + half) / (2n * from));
}

export type ContractAlert = "expired" | "expiring" | "adjustment_due" | "adjustment_overdue" | "not_started";

/** Avisos de un contrato vigente para hoy. */
export function contractAlerts(
  c: { status: ContractStatus; startDate: string; endDate: string; nextAdjustmentAt: string | null },
  today: string,
): ContractAlert[] {
  if (c.status !== "active") return [];
  const out: ContractAlert[] = [];
  if (c.startDate > today) out.push("not_started");
  if (c.endDate < today) out.push("expired");
  else if (diffDays(today, c.endDate) <= CONTRACT_EXPIRY_ALERT_DAYS) out.push("expiring");
  if (c.nextAdjustmentAt) {
    if (c.nextAdjustmentAt < today) out.push("adjustment_overdue");
    else if (diffDays(today, c.nextAdjustmentAt) <= ADJUSTMENT_ALERT_DAYS) out.push("adjustment_due");
  }
  return out;
}

export const CONTRACT_ALERT_LABELS: Record<ContractAlert, string> = {
  expired: "Vencido",
  expiring: "Vence pronto",
  adjustment_due: "Ajuste próximo",
  adjustment_overdue: "Ajuste atrasado",
  not_started: "Por comenzar",
};
