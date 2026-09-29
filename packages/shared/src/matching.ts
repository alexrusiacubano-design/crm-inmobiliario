/**
 * Matching entre lo que busca un cliente (search_profile) y el inventario. Todo es puro: el
 * servicio carga los datos y esta función decide si la propiedad entra y con qué puntaje, para
 * que las reglas se puedan probar sin base de datos y se muestren al agente tal cual.
 */
import type { Currency } from "./money";
import type { LeadOperation } from "./crm";
import type { PropertyOperation, PropertyStatus } from "./property";

export const MATCH_STATUSES = ["suggested", "sent", "interested", "discarded"] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];
export const MATCH_STATUS_LABELS: Record<MatchStatus, string> = {
  suggested: "Sugerida",
  sent: "Enviada",
  interested: "Le interesa",
  discarded: "Descartada",
};

/** Qué operación de la propiedad satisface cada operación del lead. */
export const LEAD_TO_PROPERTY_OPERATION: Record<LeadOperation, PropertyOperation> = {
  buy: "sale",
  rent: "rent",
  temporary_rent: "temporary_rent",
};

/** Estados en los que una propiedad se puede ofrecer. Reservadas y cerradas quedan afuera. */
export const MATCHABLE_PROPERTY_STATUSES: readonly PropertyStatus[] = [
  "available",
  "published",
  "negotiating",
];

/** Tolerancia sobre el precio máximo: hasta 10 % arriba entra, con penalización. */
export const PRICE_TOLERANCE_BASIS_POINTS = 1_000;
/** Puntaje mínimo para sugerir. */
export const MIN_MATCH_SCORE = 50;

export interface MatchProfile {
  operation: LeadOperation;
  propertyTypes: readonly string[];
  departmentIds: readonly number[];
  localityIds: readonly number[];
  neighborhoodIds: readonly number[];
  currency: Currency;
  priceMinMinor: bigint | null;
  priceMaxMinor: bigint | null;
  bedroomsMin: number | null;
  bathroomsMin: number | null;
  garagesMin: number | null;
  areaMin: number | null;
  commonExpensesMaxMinor: bigint | null;
  commonExpensesCurrency: Currency;
  pets: boolean;
  furnished: string; // any | yes | no
  features: readonly string[];
}

export interface MatchProperty {
  type: string;
  status: PropertyStatus;
  operations: readonly PropertyOperation[];
  departmentId: number | null;
  localityId: number | null;
  neighborhoodId: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  garages: number | null;
  /** m² edificados (o totales si no hay edificados), como texto decimal. */
  area: string | null;
  petsAllowed: boolean;
  furnished: boolean;
  features: readonly string[];
  /** Precio publicado de la operación buscada. */
  price: { currency: Currency; amountMinor: bigint } | null;
  /** Gastos comunes mensuales. */
  commonExpenses: { currency: Currency; amountMinor: bigint } | null;
}

export type MatchReasonKind = "ok" | "warn";
export interface MatchReason {
  kind: MatchReasonKind;
  text: string;
}

export interface MatchResult {
  eligible: boolean;
  /** 0–100. */
  score: number;
  reasons: MatchReason[];
  /** Por qué no entra (solo si eligible = false). */
  rejectedBy?: string;
}

/** Tipo de cambio "40,25" → pesos por dólar escalado ×10 000, sin floats. */
export function parseRate(uyuPerUsd: string): bigint {
  const [int = "0", dec = ""] = uyuPerUsd.trim().replace(",", ".").split(".");
  const scaled = BigInt(int || "0") * 10_000n + BigInt((dec + "0000").slice(0, 4) || "0");
  if (scaled <= 0n) throw new Error("Tipo de cambio inválido");
  return scaled;
}

/** Convierte montos en unidad menor entre UYU y USD con redondeo al entero más cercano. */
export function convertMinor(amountMinor: bigint, from: Currency, to: Currency, rateScaled: bigint): bigint {
  if (from === to) return amountMinor;
  if (from === "USD") return (amountMinor * rateScaled + 5_000n) / 10_000n;
  return (amountMinor * 10_000n + rateScaled / 2n) / rateScaled;
}

function areaInt(v: string | null): number | null {
  if (!v) return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Reglas (visibles al agente):
 * - Excluyentes: operación, estado ofrecible, tipo (si se indicó), zona (si se indicó), precio
 *   más de 10 % arriba del máximo, un dormitorio menos que el mínimo o más, mascotas en alquiler.
 * - Penalizan: precio hasta 10 % arriba (−15), bajo el mínimo (−5), sin precio (−10), un
 *   dormitorio menos (−15), menos baños (−8), menos garajes (−10), menos m² (−6 si falta hasta
 *   10 %, −12 si más), gastos comunes arriba del tope (−8), cada característica faltante (−4,
 *   máx. −12), amueblado distinto (−5), en negociación (−5).
 */
export function scoreMatch(p: MatchProfile, prop: MatchProperty, rateScaled: bigint): MatchResult {
  const reject = (why: string): MatchResult => ({ eligible: false, score: 0, reasons: [], rejectedBy: why });
  const wantedOp = LEAD_TO_PROPERTY_OPERATION[p.operation];
  if (!prop.operations.includes(wantedOp)) return reject("operación");
  if (!MATCHABLE_PROPERTY_STATUSES.includes(prop.status)) return reject("estado");
  if (p.propertyTypes.length && !p.propertyTypes.includes(prop.type)) return reject("tipo");

  const reasons: MatchReason[] = [];
  let score = 100;
  const ok = (text: string) => reasons.push({ kind: "ok", text });
  const warn = (text: string, penalty: number) => {
    reasons.push({ kind: "warn", text });
    score -= penalty;
  };

  const hasZones = p.departmentIds.length + p.localityIds.length + p.neighborhoodIds.length > 0;
  if (hasZones) {
    const inZone =
      (prop.neighborhoodId !== null && p.neighborhoodIds.includes(prop.neighborhoodId)) ||
      (prop.localityId !== null && p.localityIds.includes(prop.localityId)) ||
      (prop.departmentId !== null && p.departmentIds.includes(prop.departmentId));
    if (!inZone) return reject("zona");
    ok("En la zona buscada");
  }

  if (p.bedroomsMin !== null && p.bedroomsMin > 0) {
    const b = prop.bedrooms ?? 0;
    if (b < p.bedroomsMin - 1) return reject("dormitorios");
    if (b < p.bedroomsMin) warn(`${b} dormitorio(s), pidió ${p.bedroomsMin}`, 15);
    else ok(`${b} dormitorio(s)`);
  }

  if (wantedOp !== "sale" && p.pets && !prop.petsAllowed) return reject("mascotas");
  if (p.pets && prop.petsAllowed) ok("Acepta mascotas");

  // Precio en la moneda de la búsqueda.
  if (!prop.price) {
    if (p.priceMaxMinor !== null || p.priceMinMinor !== null) warn("Sin precio publicado", 10);
  } else {
    const price = convertMinor(prop.price.amountMinor, prop.price.currency, p.currency, rateScaled);
    const converted = prop.price.currency !== p.currency;
    if (p.priceMaxMinor !== null) {
      const limit = p.priceMaxMinor + (p.priceMaxMinor * BigInt(PRICE_TOLERANCE_BASIS_POINTS)) / 10_000n;
      if (price > limit) return reject("precio");
      if (price > p.priceMaxMinor) warn("Hasta 10 % arriba del presupuesto", 15);
      else ok(converted ? "Dentro del presupuesto (convertido)" : "Dentro del presupuesto");
    }
    if (p.priceMinMinor !== null && price < p.priceMinMinor) warn("Más barata que el mínimo buscado", 5);
  }

  if (p.bathroomsMin !== null && p.bathroomsMin > 0) {
    const b = prop.bathrooms ?? 0;
    if (b < p.bathroomsMin) warn(`${b} baño(s), pidió ${p.bathroomsMin}`, 8);
    else ok(`${b} baño(s)`);
  }
  if (p.garagesMin !== null && p.garagesMin > 0) {
    const g = prop.garages ?? 0;
    if (g < p.garagesMin) warn(g ? `${g} garaje(s), pidió ${p.garagesMin}` : "Sin garaje", 10);
    else ok("Con garaje");
  }
  if (p.areaMin !== null && p.areaMin > 0) {
    const a = areaInt(prop.area);
    if (a === null) warn("Sin metraje cargado", 6);
    else if (a * 10 >= p.areaMin * 9 && a < p.areaMin) warn(`${a} m², pidió ${p.areaMin}`, 6);
    else if (a < p.areaMin) warn(`${a} m², pidió ${p.areaMin}`, 12);
    else ok(`${a} m²`);
  }
  if (p.commonExpensesMaxMinor !== null && prop.commonExpenses) {
    const ge = convertMinor(
      prop.commonExpenses.amountMinor,
      prop.commonExpenses.currency,
      p.commonExpensesCurrency,
      rateScaled,
    );
    if (ge > p.commonExpensesMaxMinor) warn("Gastos comunes arriba del tope", 8);
    else ok("Gastos comunes dentro del tope");
  }
  if (p.features.length) {
    const missing = p.features.filter((f) => !prop.features.includes(f));
    const have = p.features.length - missing.length;
    if (have) ok(`${have} de ${p.features.length} característica(s) pedida(s)`);
    if (missing.length) warn(`Faltan ${missing.length} característica(s)`, Math.min(12, missing.length * 4));
  }
  if (wantedOp !== "sale" && p.furnished !== "any") {
    const wants = p.furnished === "yes";
    if (wants !== prop.furnished) warn(wants ? "No está amueblada" : "Está amueblada", 5);
    else ok(wants ? "Amueblada" : "Sin amueblar");
  }
  if (prop.status === "negotiating") warn("En negociación", 5);

  score = Math.max(0, Math.min(100, score));
  return {
    eligible: score >= MIN_MATCH_SCORE,
    score,
    reasons,
    rejectedBy: score >= MIN_MATCH_SCORE ? undefined : "puntaje",
  };
}

/** Gasto a valor mensual (bimestral /2, anual /12). Los únicos no cuentan. */
export function monthlyExpenseMinor(amountMinor: bigint, period: string): bigint | null {
  if (period === "monthly") return amountMinor;
  if (period === "bimonthly") return amountMinor / 2n;
  if (period === "annual") return amountMinor / 12n;
  return null;
}

// ─── Comparables para tasación ─────────────────────────────────────────────

export interface ComparableSample {
  priceMinor: bigint;
  areaM2: number;
}

/** Mediana de precio por m² (unidad menor por m²), redondeada. null si no hay muestras válidas. */
export function medianPricePerM2(samples: readonly ComparableSample[]): bigint | null {
  const values = samples
    .filter((s) => s.areaM2 > 0 && s.priceMinor > 0n)
    .map((s) => (s.priceMinor * 100n) / BigInt(Math.round(s.areaM2 * 100)))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (!values.length) return null;
  const mid = Math.floor(values.length / 2);
  if (values.length % 2) return values[mid] ?? null;
  const a = values[mid - 1] ?? 0n;
  const b = values[mid] ?? 0n;
  return (a + b) / 2n;
}

/** Confianza según cantidad de comparables y dispersión simple. */
export function comparableConfidence(n: number): "low" | "medium" | "high" {
  if (n >= 6) return "high";
  if (n >= 3) return "medium";
  return "low";
}
export const CONFIDENCE_LABELS = { low: "Baja", medium: "Media", high: "Alta" } as const;
