/**
 * Rendimiento comercial: métricas del parte (actividad contra metas) y competencia por puntos.
 * Todo se calcula a partir de lo que ya registra el CRM; no hay carga manual de números.
 */

export const GOAL_METRICS = [
  "visits_done",
  "properties_listed",
  "leads_attended",
  "reservations",
  "signed",
  "sales_closed",
  "rentals_closed",
] as const;
export type GoalMetric = (typeof GOAL_METRICS)[number];

export const GOAL_METRIC_LABELS: Record<GoalMetric, { label: string; hint: string }> = {
  visits_done: { label: "Visitas realizadas", hint: "Visitas de la agenda marcadas como realizadas" },
  properties_listed: { label: "Propiedades captadas", hint: "Propiedades nuevas donde sos captador" },
  leads_attended: { label: "Leads atendidos", hint: "Leads con primer contacto registrado" },
  reservations: { label: "Reservas", hint: "Operaciones que pasaron a reservada" },
  signed: { label: "Boletos y contratos firmados", hint: "Operaciones firmadas o cerradas" },
  sales_closed: { label: "Ventas cerradas", hint: "Operaciones de venta cerradas" },
  rentals_closed: { label: "Alquileres cerrados", hint: "Alquileres y temporarios cerrados" },
};

/** Puntos de la competencia. Transparentes: se muestran tal cual en la pantalla. */
export const POINT_RULES = {
  visit_done: 1,
  property_listed: 10,
  reservation: 5,
  deal_closed: 20,
  /** Por cada USD 1.000 de honorarios cobrados que le corresponden al agente (su parte). */
  per_thousand_usd: 1,
} as const;

export const POINT_RULE_LABELS: Record<keyof typeof POINT_RULES, string> = {
  visit_done: "Visita realizada",
  property_listed: "Propiedad captada",
  reservation: "Reserva",
  deal_closed: "Operación cerrada",
  per_thousand_usd: "Cada USD 1.000 cobrados (tu parte)",
};

export const PERIODS = ["week", "month", "quarter", "year", "custom"] as const;
export type Period = (typeof PERIODS)[number];
export const PERIOD_LABELS: Record<Period, string> = {
  week: "Semana",
  month: "Mes",
  quarter: "Trimestre",
  year: "Año",
  custom: "Personalizado",
};

/**
 * Rango [desde, hasta) en días "YYYY-MM-DD" para un período que contiene `today`. La semana
 * empieza el lunes. `custom` usa las fechas dadas (hasta inclusive → exclusivo +1 día).
 */
export function periodRange(
  period: Period,
  today: string,
  custom?: { from?: string | null; to?: string | null },
): { from: string; to: string; months: number } {
  const [y = 1970, m = 1, d = 1] = today.split("-").map(Number);
  const iso = (dt: Date) => dt.toISOString().slice(0, 10);
  const utc = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm - 1, dd));
  if (period === "week") {
    const dow = (utc(y, m, d).getUTCDay() + 6) % 7;
    return { from: iso(utc(y, m, d - dow)), to: iso(utc(y, m, d - dow + 7)), months: 7 / 30 };
  }
  if (period === "month") return { from: iso(utc(y, m, 1)), to: iso(utc(y, m + 1, 1)), months: 1 };
  if (period === "quarter") {
    const q = Math.floor((m - 1) / 3) * 3 + 1;
    return { from: iso(utc(y, q, 1)), to: iso(utc(y, q + 3, 1)), months: 3 };
  }
  if (period === "year") return { from: iso(utc(y, 1, 1)), to: iso(utc(y + 1, 1, 1)), months: 12 };
  const from = custom?.from ?? iso(utc(y, m, 1));
  const toIncl = custom?.to ?? today;
  const [ty = y, tm = m, td = d] = toIncl.split("-").map(Number);
  const to = iso(utc(ty, tm, td + 1));
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  return { from, to, months: Math.max(days, 1) / 30 };
}

/** Meta del período a partir de la mensual (redondeo hacia arriba: no se regala meta). */
export function periodTarget(monthly: number, months: number): number {
  return Math.ceil(monthly * months);
}
