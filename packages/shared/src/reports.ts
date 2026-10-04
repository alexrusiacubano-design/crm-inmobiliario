/**
 * Reportes: funciones puras de agregación (embudo, medianas, tasas, CSV).
 */
import { LEAD_STATUSES, type LeadStatus } from "./crm";

/** Etapas del embudo en orden (perdido queda fuera: se informa aparte). */
export const FUNNEL_STAGES = [
  "new",
  "contacted",
  "qualified",
  "visit",
  "offer",
  "reservation",
  "won",
] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export function stageRank(status: string | null | undefined): number {
  return FUNNEL_STAGES.indexOf(status as FunnelStage);
}

/**
 * Cuántos leads llegaron al menos a cada etapa. `reached` es la etapa más avanzada de cada
 * lead (según su historial), así un lead perdido después de visitar cuenta en "Visita".
 */
export function funnelCounts(reached: readonly (string | null)[]): { stage: FunnelStage; count: number }[] {
  const ranks = reached.map((s) => Math.max(0, stageRank(s)));
  return FUNNEL_STAGES.map((stage, i) => ({ stage, count: ranks.filter((r) => r >= i).length }));
}

/** Etapa más avanzada entre la actual y las del historial (perdido no avanza). */
export function furthestStage(current: LeadStatus, history: readonly string[]): FunnelStage {
  let best = Math.max(0, stageRank(current));
  for (const h of history) best = Math.max(best, stageRank(h));
  return FUNNEL_STAGES[best] ?? "new";
}

export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? null) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

/** Porcentaje entero (null si no hay base). */
export function pct(part: number, total: number): number | null {
  return total > 0 ? Math.round((part / total) * 100) : null;
}

/** Los últimos `n` meses terminando en el de `today`, como "YYYY-MM". */
export function lastMonths(today: string, n: number): string[] {
  const [y = 1970, m = 1] = today.split("-").map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `${MONTHS_ES[Number(m) - 1] ?? m} ${y?.slice(2)}`;
}

/** CSV con separador ";" (Excel en español) y comillas cuando hace falta. */
export function toCsv(
  header: readonly string[],
  rows: readonly (readonly (string | number | null | undefined)[])[],
): string {
  const cell = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return "";
    let s = String(v);
    // Evita inyección de fórmulas al abrir en planillas.
    if (/^[=+\-@\t\r]/.test(s) && typeof v === "string") s = `'${s}`;
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `\uFEFF${[header, ...rows].map((r) => r.map(cell).join(";")).join("\r\n")}\r\n`;
}

export const REPORT_TABS = ["commercial", "operations", "rentals", "inventory"] as const;
export type ReportTab = (typeof REPORT_TABS)[number];
export const REPORT_TAB_LABELS: Record<ReportTab, string> = {
  commercial: "Comercial",
  operations: "Operaciones y honorarios",
  rentals: "Alquileres",
  inventory: "Inventario",
};

export const LEAD_STATUS_ORDER: readonly LeadStatus[] = LEAD_STATUSES;
