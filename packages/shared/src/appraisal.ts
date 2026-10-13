/**
 * Tasación por el método metrológico (regresión sobre antecedentes).
 *
 * Cada antecedente se describe con su superficie (m²), un puntaje de construcción y uno de
 * ubicación (misma escala para todos, p. ej. 1 = malo … 5 = excelente) y su valor de venta.
 *
 * 1. Matriz K: se ajusta el modelo  valor = K₀ + K₁·m² + K₂·construcción + K₃·ubicación  por
 *    mínimos cuadrados (con 4 antecedentes la solución es exacta: la "matriz inversa").
 * 2. Coeficientes de ajuste: cada antecedente se lleva al bien problema corrigiendo cada
 *    característica:  fⱼ = 1 + Kⱼ·(xⱼ bien − xⱼ antecedente) / valor del antecedente,
 *    y C = f(m²)·f(construcción)·f(ubicación).  Valor ajustado = valor × C.
 * 3. Valor probable = promedio de los valores ajustados. Incertidumbre (90 % de confianza) a
 *    partir de la dispersión de los valores ajustados (intervalo de predicción):
 *    t₉₀ · s · √(1 + 1/n) / promedio de los valores de venta, con t de Student bilateral y
 *    n − (variables + 1) grados de libertad (mínimo 1). Rango = probable ± incertidumbre.
 * 4. Un K negativo en construcción o ubicación (mejor calidad → menor precio) indica una muestra
 *    incongruente: se señala el antecedente que más probablemente la causa.
 */

export const APPRAISAL_STATUSES = ["draft", "final"] as const;
export type AppraisalStatus = (typeof APPRAISAL_STATUSES)[number];
export const APPRAISAL_STATUS_LABELS: Record<AppraisalStatus, string> = {
  draft: "Borrador",
  final: "Finalizada",
};

export const COMPARABLE_KINDS = ["real", "offer"] as const;
export type ComparableKind = (typeof COMPARABLE_KINDS)[number];
export const COMPARABLE_KIND_LABELS: Record<ComparableKind, string> = { real: "Real", offer: "Oferta" };

/** Escala sugerida para construcción y ubicación. */
export const SCORE_MIN = 1;
export const SCORE_MAX = 10;
export const SCORE_HINT = "1 = malo · 3 = normal · 5 = excelente";

/** Descuento opcional de negociación sobre precios publicados. */
export const DEFAULT_OFFER_DISCOUNT_BP = 0;

export interface AppraisalComparable {
  /** Dirección o referencia ("Bvar. Artigas y Rivera"). Opcional. */
  reference: string;
  m2: number | null;
  /** Puntaje de construcción (escala común a todos los antecedentes y al bien). */
  construction: number | null;
  /** Puntaje de ubicación. */
  location: number | null;
  kind: ComparableKind;
  /** Valor de venta en la moneda de la tasación (unidades, no centésimos). */
  price: number | null;
  url?: string | null;
  sourceCode?: string | null;
  /** Versión de la escala (2 = puntajes absolutos). */
  v?: number;
}

export interface AppraisalSubject {
  m2: number | null;
  construction: number | null;
  location: number | null;
}

export type AppraisalVariable = "m2" | "construction" | "location";
export const APPRAISAL_VARIABLE_LABELS: Record<AppraisalVariable, string> = {
  m2: "M²",
  construction: "Construcción",
  location: "Ubicación",
};

export interface MatrixK {
  constant: number;
  m2: number | null;
  construction: number | null;
  location: number | null;
}

export interface ComparableResult {
  index: number;
  valid: boolean;
  /** Valor usado (con descuento si es oferta). */
  value: number | null;
  unit: number | null;
  factors: Record<AppraisalVariable, number> | null;
  coefficient: number | null;
  adjusted: number | null;
}

export interface AppraisalWarning {
  variable: AppraisalVariable;
  /** Índice (0-based) del antecedente que más probablemente causa la incongruencia. */
  cause: number | null;
}

export interface AppraisalResult {
  count: number;
  rows: ComparableResult[];
  k: MatrixK | null;
  /** Variables que entraron al modelo (las que no varían o sobran se descartan). */
  variables: AppraisalVariable[];
  unitAverage: number | null;
  /** Referencia simple: m² del bien × promedio por m². */
  simpleEstimate: number | null;
  probable: number | null;
  min: number | null;
  max: number | null;
  stdDev: number | null;
  /** Incertidumbre relativa (0,042 = 4,2 %). */
  uncertainty: number | null;
  confidence: number;
  warnings: AppraisalWarning[];
}

/** t de Student bilateral al 90 % según grados de libertad. */
function t90(df: number): number {
  const table: [number, number][] = [
    [1, 6.314],
    [2, 2.92],
    [3, 2.353],
    [4, 2.132],
    [5, 2.015],
    [6, 1.943],
    [7, 1.895],
    [8, 1.86],
    [9, 1.833],
    [10, 1.812],
    [12, 1.782],
    [15, 1.753],
    [20, 1.725],
    [30, 1.697],
  ];
  for (const [d, t] of table) if (df <= d) return t;
  return 1.645;
}

/** Resuelve A·x = b por eliminación gaussiana con pivoteo; null si es singular. */
function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i] as number]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++)
      if (Math.abs((m[r] as number[])[col] as number) > Math.abs((m[piv] as number[])[col] as number))
        piv = r;
    const pv = (m[piv] as number[])[col] as number;
    if (Math.abs(pv) < 1e-9) return null;
    [m[col], m[piv]] = [m[piv] as number[], m[col] as number[]];
    const rowC = m[col] as number[];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const row = m[r] as number[];
      const f = (row[col] as number) / (rowC[col] as number);
      for (let c = col; c <= n; c++) row[c] = (row[c] as number) - f * (rowC[c] as number);
    }
  }
  return m.map((row, i) => (row[n] as number) / (row[i] as number));
}

/** Mínimos cuadrados (ecuaciones normales) con intercepto. */
function regress(xs: number[][], ys: number[]): number[] | null {
  const p = (xs[0]?.length ?? 0) + 1;
  const ata = Array.from({ length: p }, () => Array<number>(p).fill(0));
  const atb = Array<number>(p).fill(0);
  xs.forEach((x, i) => {
    const row = [1, ...x];
    for (let r = 0; r < p; r++) {
      atb[r] = (atb[r] as number) + (row[r] as number) * (ys[i] as number);
      for (let c = 0; c < p; c++)
        (ata[r] as number[])[c] =
          ((ata[r] as number[])[c] as number) + (row[r] as number) * (row[c] as number);
    }
  });
  return solve(ata, atb);
}

const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;

export function roundAppraisal(value: number, currency: "USD" | "UYU"): number {
  const step = currency === "USD" ? 100 : 1000;
  return Math.round(value / step) * step;
}

/** Superficie del bien: edificada si la hay; si no (terrenos), la total. */
export function appraisalArea(
  builtArea: number | null | undefined,
  totalArea: number | null | undefined,
): number | null {
  if (builtArea && builtArea > 0) return builtArea;
  if (totalArea && totalArea > 0) return totalArea;
  return null;
}

export function computeAppraisal(input: {
  subject: AppraisalSubject;
  comparables: readonly AppraisalComparable[];
  offerDiscountBp: number;
}): AppraisalResult {
  const offerFactor = 1 - input.offerDiscountBp / 10_000;
  const rows: ComparableResult[] = input.comparables.map((c, index) => {
    const valid = Boolean(c.m2 && c.m2 > 0 && c.price && c.price > 0);
    const value = valid ? (c.price as number) * (c.kind === "offer" ? offerFactor : 1) : null;
    return {
      index,
      valid,
      value,
      unit: value !== null ? value / (c.m2 as number) : null,
      factors: null,
      coefficient: null,
      adjusted: null,
    };
  });
  const sample = rows.filter((r) => r.valid);
  const n = sample.length;
  const empty: AppraisalResult = {
    count: n,
    rows,
    k: null,
    variables: [],
    unitAverage: null,
    simpleEstimate: null,
    probable: null,
    min: null,
    max: null,
    stdDev: null,
    uncertainty: null,
    confidence: 0.9,
    warnings: [],
  };
  if (n === 0) return empty;

  const comp = (r: ComparableResult) => input.comparables[r.index] as AppraisalComparable;
  const subj: Record<AppraisalVariable, number | null> = {
    m2: input.subject.m2 && input.subject.m2 > 0 ? input.subject.m2 : null,
    construction: input.subject.construction ?? null,
    location: input.subject.location ?? null,
  };
  const xOf = (r: ComparableResult, v: AppraisalVariable) => {
    const c = comp(r);
    return v === "m2" ? (c.m2 as number) : (c[v] ?? subj[v] ?? 0);
  };

  // Variables del modelo: solo las que varían en la muestra y tienen valor en el bien.
  let vars = (["m2", "construction", "location"] as AppraisalVariable[]).filter((v) => {
    if (subj[v] === null) return false;
    const xs = sample.map((r) => xOf(r, v));
    return Math.max(...xs) - Math.min(...xs) > 1e-9;
  });
  while (vars.length + 1 > n) vars = vars.slice(0, -1);

  let coef: number[] | null = null;
  while (vars.length > 0) {
    coef = regress(
      sample.map((r) => vars.map((v) => xOf(r, v))),
      sample.map((r) => r.value as number),
    );
    if (coef) break;
    vars = vars.slice(0, -1);
  }
  const kOf = (v: AppraisalVariable) =>
    coef && vars.includes(v) ? (coef[vars.indexOf(v) + 1] as number) : null;
  const k: MatrixK | null =
    coef && vars.length
      ? {
          constant: coef[0] as number,
          m2: kOf("m2"),
          construction: kOf("construction"),
          location: kOf("location"),
        }
      : null;

  const units = sample.map((r) => r.unit as number);
  const unitAverage = mean(units);
  const simpleEstimate = subj.m2 ? unitAverage * subj.m2 : null;

  for (const r of sample) {
    const factors = { m2: 1, construction: 1, location: 1 } as Record<AppraisalVariable, number>;
    if (k) {
      for (const v of vars) {
        const kv = kOf(v) as number;
        factors[v] = 1 + (kv * ((subj[v] as number) - xOf(r, v))) / (r.value as number);
      }
    } else if (subj.m2) {
      // Sin modelo (un solo antecedente o sin variación): ajuste proporcional por m².
      factors.m2 = subj.m2 / xOf(r, "m2");
    }
    r.factors = factors;
    r.coefficient = factors.m2 * factors.construction * factors.location;
    r.adjusted = k || subj.m2 ? (r.value as number) * r.coefficient : null;
  }

  const adjusted = sample.flatMap((r) => (r.adjusted === null ? [] : [r.adjusted]));
  const probable = adjusted.length ? mean(adjusted) : null;
  const stdDev =
    adjusted.length > 1 && probable !== null
      ? Math.sqrt(adjusted.reduce((s, x) => s + (x - probable) ** 2, 0) / (adjusted.length - 1))
      : 0;
  const valueAverage = mean(sample.map((r) => r.value as number));
  const df = Math.max(adjusted.length - (vars.length + 1), 1);
  const uncertainty =
    adjusted.length > 1
      ? Math.max((t90(df) * stdDev * Math.sqrt(1 + 1 / adjusted.length)) / valueAverage, 0.01)
      : 0.1;

  // K negativo en una característica de calidad: buscar el antecedente que más lo explica
  // (calidad por encima del promedio con valor por m² por debajo del promedio, o viceversa).
  const warnings: AppraisalWarning[] = [];
  for (const v of ["construction", "location"] as AppraisalVariable[]) {
    const kv = kOf(v);
    if (kv === null || kv >= 0) continue;
    const xm = mean(sample.map((r) => xOf(r, v)));
    let best: { idx: number; score: number } | null = null;
    for (const r of sample) {
      const score = (xOf(r, v) - xm) * (unitAverage - (r.unit as number));
      if (!best || score > best.score) best = { idx: r.index, score };
    }
    warnings.push({ variable: v, cause: best && best.score > 0 ? best.idx : null });
  }

  return {
    count: n,
    rows,
    k,
    variables: vars,
    unitAverage,
    simpleEstimate,
    probable,
    min: probable !== null ? probable * (1 - uncertainty) : null,
    max: probable !== null ? probable * (1 + uncertainty) : null,
    stdDev,
    uncertainty,
    confidence: 0.9,
    warnings,
  };
}

/**
 * Antecedentes guardados con la escala anterior (−2…+2 respecto del bien): se convierten a
 * puntajes absolutos tomando al bien como 3.
 */
export function normalizeComparable(c: AppraisalComparable): AppraisalComparable {
  if (c.v === 2) return c;
  const conv = (x: number | null) => (x === null || x === undefined ? null : x >= -2 && x <= 2 ? x + 3 : x);
  return { ...c, construction: conv(c.construction), location: conv(c.location) };
}
