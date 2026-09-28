/**
 * Fechas en la zona horaria de la organización, sin librerías: la agenda se dibuja por día
 * local (no por día UTC) y los formularios convierten "fecha + hora" local a un instante.
 */

export const DEFAULT_TZ = "America/Montevideo";

function parts(date: Date, tz: string) {
  const out: Record<string, number> = {};
  for (const p of new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return out as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Minutos que la zona está adelantada respecto de UTC en ese instante (Montevideo: -180). */
export function tzOffsetMinutes(date: Date, tz: string): number {
  const p = parts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** "2026-09-28" + "17:30" en la zona → instante. */
export function zonedToDate(ymd: string, hm: string, tz: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  const [hh, mm] = hm.split(":").map(Number);
  const guess = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0);
  const offset = tzOffsetMinutes(new Date(guess), tz);
  const first = guess - offset * 60000;
  // Segunda pasada por si el desplazamiento cambia justo en ese día (horario de verano).
  const offset2 = tzOffsetMinutes(new Date(first), tz);
  return new Date(guess - offset2 * 60000);
}

/** Día local "YYYY-MM-DD" de un instante. */
export function ymdInTz(date: Date, tz: string): string {
  const p = parts(date, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Hora local "HH:MM". */
export function hmInTz(date: Date, tz: string): string {
  const p = parts(date, tz);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** Suma días a una fecha "YYYY-MM-DD" (aritmética de calendario, sin zona). */
export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days));
  return t.toISOString().slice(0, 10);
}

/** 0 = lunes … 6 = domingo. */
export function weekdayMon0(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return (new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay() + 6) % 7;
}

export function isYmd(v: unknown): v is string {
  return (
    typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
  );
}

export function formatDayLong(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat("es-UY", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)));
}

export function formatMonthYear(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat("es-UY", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, 1)),
  );
}

/** "setiembre de 2026" → "Setiembre de 2026" (solo la primera letra). */
export function capitalizeFirst(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
