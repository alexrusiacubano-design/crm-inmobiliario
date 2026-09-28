/**
 * Dinero seguro: los importes se guardan como enteros en la unidad menor (centésimos)
 * usando `bigint`. Nunca se usa `number` de punto flotante para importes.
 */

export const CURRENCIES = ["UYU", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Decimales de la unidad menor por moneda. Ambas usan centésimos. */
const MINOR_UNITS: Record<Currency, number> = { UYU: 2, USD: 2 };

/** Prefijo habitual en Uruguay: "$" para pesos y "U$S" para dólares. */
const SYMBOLS: Record<Currency, string> = { UYU: "$", USD: "U$S" };

export interface Money {
  readonly amountMinor: bigint;
  readonly currency: Currency;
}

export class MoneyError extends Error {
  override readonly name = "MoneyError";
}

export function isCurrency(value: unknown): value is Currency {
  return typeof value === "string" && (CURRENCIES as readonly string[]).includes(value);
}

export function money(amountMinor: bigint, currency: Currency): Money {
  if (typeof amountMinor !== "bigint") throw new MoneyError("El importe debe ser bigint");
  if (!isCurrency(currency)) throw new MoneyError(`Moneda no soportada: ${String(currency)}`);
  return Object.freeze({ amountMinor, currency });
}

export function zero(currency: Currency): Money {
  return money(0n, currency);
}

/**
 * Convierte un texto decimal ("230000", "1234.5", "1.234,50") a Money sin pasar por float.
 * Acepta punto o coma como separador decimal; los separadores de miles se ignoran
 * cuando el formato es inequívoco.
 */
export function parseMoney(input: string, currency: Currency): Money {
  const raw = input.trim().replace(/\s/g, "");
  if (raw === "") throw new MoneyError("Importe vacío");
  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;

  let normalized: string;
  const lastComma = unsigned.lastIndexOf(",");
  const lastDot = unsigned.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    // El último separador que aparece es el decimal.
    const decimalSep = lastComma > lastDot ? "," : ".";
    const thousandsSep = decimalSep === "," ? "." : ",";
    normalized = unsigned.split(thousandsSep).join("").replace(decimalSep, ".");
  } else if (lastComma > -1) {
    normalized = unsigned.replace(",", ".");
  } else if (lastDot > -1 && /^\d{1,3}(\.\d{3})+$/.test(unsigned)) {
    // "230.000" es formato uruguayo de miles, no decimales.
    normalized = unsigned.split(".").join("");
  } else {
    normalized = unsigned;
  }

  if (!/^\d+(\.\d+)?$/.test(normalized)) throw new MoneyError(`Importe inválido: ${input}`);
  const [intPart = "0", fracPart = ""] = normalized.split(".");
  const digits = MINOR_UNITS[currency];
  if (fracPart.length > digits) {
    throw new MoneyError(`El importe tiene más de ${digits} decimales: ${input}`);
  }
  const minor = BigInt(intPart) * 10n ** BigInt(digits) + BigInt(fracPart.padEnd(digits, "0") || "0");
  return money(negative ? -minor : minor, currency);
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new MoneyError(`No se pueden combinar ${a.currency} y ${b.currency} sin tipo de cambio explícito`);
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor + b.amountMinor, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor - b.amountMinor, a.currency);
}

export function sum(items: readonly Money[], currency: Currency): Money {
  return items.reduce((acc, m) => add(acc, m), zero(currency));
}

export function equals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amountMinor === b.amountMinor;
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  return a.amountMinor < b.amountMinor ? -1 : a.amountMinor > b.amountMinor ? 1 : 0;
}

/** 10000 basis points = 100 %. */
export const BASIS_POINTS_TOTAL = 10_000;

/** Redondeo "half-even" (bancario) de una división entera. */
function divRoundHalfEven(numerator: bigint, denominator: bigint): bigint {
  const q = numerator / denominator;
  const r = numerator % denominator;
  const twice = (r < 0n ? -r : r) * 2n;
  const absDen = denominator < 0n ? -denominator : denominator;
  if (twice < absDen) return q;
  if (twice > absDen) return q + (numerator < 0n !== denominator < 0n ? -1n : 1n);
  // Exactamente la mitad: al par.
  return q % 2n === 0n ? q : q + (numerator < 0n !== denominator < 0n ? -1n : 1n);
}

/** Aplica un porcentaje expresado en basis points (p. ej. 300 = 3 %), redondeando half-even. */
export function percentage(base: Money, basisPoints: number): Money {
  if (!Number.isInteger(basisPoints)) throw new MoneyError("Los basis points deben ser enteros");
  return money(
    divRoundHalfEven(base.amountMinor * BigInt(basisPoints), BigInt(BASIS_POINTS_TOTAL)),
    base.currency,
  );
}

/**
 * Reparte un importe según pesos enteros (normalmente basis points) usando el método del
 * mayor residuo. La suma de las partes es SIEMPRE igual al total.
 */
export function allocate(total: Money, weights: readonly number[]): Money[] {
  if (weights.length === 0) throw new MoneyError("Se necesita al menos una parte");
  if (weights.some((w) => !Number.isInteger(w) || w < 0)) {
    throw new MoneyError("Los pesos deben ser enteros no negativos");
  }
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum === 0) throw new MoneyError("La suma de los pesos no puede ser cero");

  const sign = total.amountMinor < 0n ? -1n : 1n;
  const absTotal = total.amountMinor * sign;
  const bigSum = BigInt(weightSum);

  const parts = weights.map((w, index) => {
    const exact = absTotal * BigInt(w);
    return { index, floor: exact / bigSum, remainder: exact % bigSum };
  });
  let leftover = absTotal - parts.reduce((acc, p) => acc + p.floor, 0n);
  const byRemainder = [...parts].sort((a, b) =>
    b.remainder === a.remainder ? a.index - b.index : b.remainder > a.remainder ? 1 : -1,
  );
  for (const part of byRemainder) {
    if (leftover === 0n) break;
    part.floor += 1n;
    leftover -= 1n;
  }
  return parts.map((p) => money(p.floor * sign, total.currency));
}

/** Formatea para Uruguay: "U$S 230.000", "$ 1.234,50". */
export function formatMoney(
  value: Money,
  options: { showDecimals?: "auto" | "always" | "never" } = {},
): string {
  const { showDecimals = "auto" } = options;
  const digits = MINOR_UNITS[value.currency];
  const factor = 10n ** BigInt(digits);
  const negative = value.amountMinor < 0n;
  const abs = negative ? -value.amountMinor : value.amountMinor;
  const intPart = (abs / factor).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const frac = (abs % factor).toString().padStart(digits, "0");
  const withDecimals = showDecimals === "always" || (showDecimals === "auto" && frac !== "0".repeat(digits));
  const body = withDecimals ? `${intPart},${frac}` : intPart;
  return `${negative ? "-" : ""}${SYMBOLS[value.currency]} ${body}`;
}

/** Serialización segura para JSON (bigint no es serializable). */
export function toJSON(value: Money): { amountMinor: string; currency: Currency } {
  return { amountMinor: value.amountMinor.toString(), currency: value.currency };
}

export function fromJSON(value: { amountMinor: string; currency: string }): Money {
  if (!/^-?\d+$/.test(value.amountMinor)) throw new MoneyError("amountMinor inválido");
  if (!isCurrency(value.currency)) throw new MoneyError("Moneda inválida");
  return money(BigInt(value.amountMinor), value.currency);
}

/** "3", "3,5", "33.33" → basis points (300, 350, 3333) sin pasar por float. Máximo 2 decimales. */
export function parsePercentToBasisPoints(input: string): number {
  const raw = input.replace("%", "").trim().replace(",", ".");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(raw)) throw new MoneyError(`Porcentaje inválido: ${input}`);
  const [int = "0", frac = ""] = raw.split(".");
  const bp = Number(int) * 100 + Number(frac.padEnd(2, "0"));
  if (bp > BASIS_POINTS_TOTAL) throw new MoneyError("El porcentaje no puede superar 100 %");
  return bp;
}

/** 350 → "3,5 %" */
export function formatBasisPoints(bp: number): string {
  const int = Math.trunc(bp / 100);
  const frac = String(bp % 100)
    .padStart(2, "0")
    .replace(/0+$/, "");
  return `${int}${frac ? `,${frac}` : ""} %`;
}
