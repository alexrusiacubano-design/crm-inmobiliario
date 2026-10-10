/**
 * Tasación por comparables con homogeneización: cada antecedente se lleva al valor por m² y se
 * ajusta por las diferencias con el inmueble a tasar (calidad de construcción, ubicación) y por
 * ser una venta concretada o una oferta publicada (que suele cerrarse más abajo).
 *
 * Los factores expresan cómo es el comparable RESPECTO del inmueble tasado: si el comparable es
 * mejor, su precio por m² se corrige hacia abajo; si es peor, hacia arriba.
 */

export const APPRAISAL_STATUSES = ["draft", "final"] as const;
export type AppraisalStatus = (typeof APPRAISAL_STATUSES)[number];
export const APPRAISAL_STATUS_LABELS: Record<AppraisalStatus, string> = {
  draft: "Borrador",
  final: "Finalizada",
};

/** Escala relativa: −2 mucho peor … +2 mucho mejor que el inmueble tasado. */
export const COMPARISON_LEVELS = [-2, -1, 0, 1, 2] as const;
export type ComparisonLevel = (typeof COMPARISON_LEVELS)[number];
export const COMPARISON_LABELS: Record<ComparisonLevel, string> = {
  [-2]: "Mucho peor",
  [-1]: "Peor",
  0: "Similar",
  1: "Mejor",
  2: "Mucho mejor",
};
export const COMPARISON_FACTORS: Record<ComparisonLevel, number> = {
  [-2]: 1.15,
  [-1]: 1.07,
  0: 1,
  1: 0.93,
  2: 0.87,
};

export const COMPARABLE_KINDS = ["real", "offer"] as const;
export type ComparableKind = (typeof COMPARABLE_KINDS)[number];
export const COMPARABLE_KIND_LABELS: Record<ComparableKind, string> = { real: "Real", offer: "Oferta" };

/** Descuento habitual de negociación sobre precios publicados (7 %). */
export const DEFAULT_OFFER_DISCOUNT_BP = 700;

export interface AppraisalComparable {
  /** Dirección o referencia ("Bvar. Artigas y Rivera, 3er piso"). */
  reference: string;
  m2: number | null;
  construction: ComparisonLevel;
  location: ComparisonLevel;
  kind: ComparableKind;
  /** Precio total en la moneda de la tasación (unidades, no centésimos). */
  price: number | null;
  url?: string | null;
  /** Propiedad del CRM de la que salió (si se trajo desde el comparador). */
  sourceCode?: string | null;
}

export interface ComparableResult {
  index: number;
  valid: boolean;
  unitRaw: number | null;
  factor: number;
  unitAdjusted: number | null;
}

export interface AppraisalResult {
  rows: ComparableResult[];
  count: number;
  unitAverage: number | null;
  unitMedian: number | null;
  unitMin: number | null;
  unitMax: number | null;
  /** Coeficiente de variación de los valores homogeneizados (dispersión). */
  dispersion: number | null;
  value: number | null;
  min: number | null;
  max: number | null;
}

export function comparableFactor(c: Pick<AppraisalComparable, "construction" | "location" | "kind">, offerDiscountBp: number) {
  const offer = c.kind === "offer" ? 1 - offerDiscountBp / 10_000 : 1;
  return (COMPARISON_FACTORS[c.construction] ?? 1) * (COMPARISON_FACTORS[c.location] ?? 1) * offer;
}

/** Redondeo comercial: a 100 en dólares y a 1.000 en pesos. */
export function roundAppraisal(value: number, currency: "USD" | "UYU"): number {
  const step = currency === "USD" ? 100 : 1000;
  return Math.round(value / step) * step;
}

/** Superficie de cálculo: edificada si la hay; si no (terrenos), la total. */
export function appraisalArea(builtArea: number | null | undefined, totalArea: number | null | undefined): number | null {
  if (builtArea && builtArea > 0) return builtArea;
  if (totalArea && totalArea > 0) return totalArea;
  return null;
}

export function computeAppraisal(input: {
  area: number | null;
  comparables: readonly AppraisalComparable[];
  offerDiscountBp: number;
  currency: "USD" | "UYU";
}): AppraisalResult {
  const rows: ComparableResult[] = input.comparables.map((c, index) => {
    const valid = Boolean(c.m2 && c.m2 > 0 && c.price && c.price > 0);
    const factor = comparableFactor(c, input.offerDiscountBp);
    const unitRaw = valid ? (c.price as number) / (c.m2 as number) : null;
    return { index, valid, unitRaw, factor, unitAdjusted: unitRaw === null ? null : unitRaw * factor };
  });
  const units = rows.flatMap((r) => (r.unitAdjusted === null ? [] : [r.unitAdjusted])).sort((a, b) => a - b);
  const count = units.length;
  if (count === 0)
    return {
      rows,
      count,
      unitAverage: null,
      unitMedian: null,
      unitMin: null,
      unitMax: null,
      dispersion: null,
      value: null,
      min: null,
      max: null,
    };
  const avg = units.reduce((s, u) => s + u, 0) / count;
  const mid = Math.floor(count / 2);
  const median = count % 2 ? (units[mid] as number) : ((units[mid - 1] as number) + (units[mid] as number)) / 2;
  const sd = Math.sqrt(units.reduce((s, u) => s + (u - avg) ** 2, 0) / count);
  const area = input.area && input.area > 0 ? input.area : null;
  // Rango: el valor ± el desvío de los comparables, nunca menos de ±5 %.
  const spread = Math.max(sd / avg, 0.05);
  return {
    rows,
    count,
    unitAverage: avg,
    unitMedian: median,
    unitMin: units[0] ?? null,
    unitMax: units[count - 1] ?? null,
    dispersion: count > 1 ? sd / avg : 0,
    value: area ? roundAppraisal(avg * area, input.currency) : null,
    min: area ? roundAppraisal(avg * area * (1 - spread), input.currency) : null,
    max: area ? roundAppraisal(avg * area * (1 + spread), input.currency) : null,
  };
}
