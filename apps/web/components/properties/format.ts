import { formatMoney, money, type Currency } from "@crm/shared/money";

/** Unidad menor → texto editable ("230000" o "1234,50"), sin pasar por float. */
export function minorToInput(v: bigint | string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  const n = BigInt(v);
  const cents = n % 100n;
  return cents === 0n ? (n / 100n).toString() : `${n / 100n},${cents.toString().padStart(2, "0")}`;
}

export function price(v: bigint | string | null | undefined, currency: Currency): string {
  if (v === null || v === undefined) return "—";
  return formatMoney(money(BigInt(v), currency));
}

/** "2026-03-01" → "01/03/2026" sin problemas de zona horaria. */
export function formatDay(value: string | null | undefined): string {
  if (!value) return "—";
  const [y, m, d] = value.split("-");
  return `${d}/${m}/${y}`;
}

/** Días hasta una fecha ISO (negativo si ya pasó). */
export function daysUntil(value: string): number {
  const target = new Date(`${value}T12:00:00`);
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}
