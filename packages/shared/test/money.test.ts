import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  add,
  allocate,
  formatMoney,
  fromJSON,
  money,
  MoneyError,
  parseMoney,
  percentage,
  subtract,
  sum,
  toJSON,
} from "../src/money";

describe("Money", () => {
  it("parsea formatos habituales sin pasar por float", () => {
    expect(parseMoney("230000", "USD").amountMinor).toBe(23_000_000n);
    expect(parseMoney("230.000", "USD").amountMinor).toBe(23_000_000n);
    expect(parseMoney("1.234,50", "UYU").amountMinor).toBe(123_450n);
    expect(parseMoney("1,234.50", "UYU").amountMinor).toBe(123_450n);
    expect(parseMoney("0,1", "UYU").amountMinor).toBe(10n);
    expect(parseMoney("-15,25", "UYU").amountMinor).toBe(-1_525n);
    // 0.1 + 0.2 en float da 0.30000000000000004; aquí es exacto.
    expect(add(parseMoney("0.1", "USD"), parseMoney("0.2", "USD"))).toEqual(parseMoney("0.3", "USD"));
  });

  it("rechaza entradas inválidas o con más decimales de los permitidos", () => {
    expect(() => parseMoney("abc", "USD")).toThrow(MoneyError);
    expect(() => parseMoney("1,005", "USD")).toThrow(MoneyError);
    // "1.005" es formato uruguayo de miles (mil cinco), no 1,005 dólares.
    expect(parseMoney("1.005", "USD").amountMinor).toBe(100_500n);
    expect(() => parseMoney("", "USD")).toThrow(MoneyError);
  });

  it("no mezcla monedas", () => {
    expect(() => add(money(100n, "USD"), money(100n, "UYU"))).toThrow(/tipo de cambio/);
  });

  it("suma, resta y serializa", () => {
    const total = sum([money(100n, "UYU"), money(250n, "UYU")], "UYU");
    expect(total.amountMinor).toBe(350n);
    expect(subtract(total, money(50n, "UYU")).amountMinor).toBe(300n);
    expect(fromJSON(toJSON(total))).toEqual(total);
  });

  it("formatea al estilo uruguayo", () => {
    expect(formatMoney(parseMoney("230000", "USD"))).toBe("U$S 230.000");
    expect(formatMoney(parseMoney("1234,5", "UYU"))).toBe("$ 1.234,50");
    expect(formatMoney(parseMoney("-7500", "USD"))).toBe("-U$S 7.500");
    expect(formatMoney(parseMoney("10", "UYU"), { showDecimals: "always" })).toBe("$ 10,00");
  });

  it("aplica porcentajes en basis points con redondeo bancario", () => {
    // 3 % de U$S 250.000 = U$S 7.500
    expect(percentage(parseMoney("250000", "USD"), 300)).toEqual(parseMoney("7500", "USD"));
    // 0,5 centésimos redondea al par
    expect(percentage(money(5n, "USD"), 1_000).amountMinor).toBe(0n); // 0.5 → 0
    expect(percentage(money(15n, "USD"), 1_000).amountMinor).toBe(2n); // 1.5 → 2
    expect(percentage(money(-15n, "USD"), 1_000).amountMinor).toBe(-2n);
  });

  it("reparte la comisión del ejemplo: 30/30/40 de U$S 7.500", () => {
    const parts = allocate(parseMoney("7500", "USD"), [3000, 3000, 4000]);
    expect(parts.map((p) => formatMoney(p))).toEqual(["U$S 2.250", "U$S 2.250", "U$S 3.000"]);
  });

  it("reparte asignando el resto por mayor residuo", () => {
    const parts = allocate(money(100n, "UYU"), [1, 1, 1]);
    expect(parts.map((p) => p.amountMinor)).toEqual([34n, 33n, 33n]);
  });

  it("propiedad: la suma de las partes siempre es igual al total", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -10_000_000_000n, max: 10_000_000_000n }),
        fc
          .array(fc.integer({ min: 0, max: 10_000 }), { minLength: 1, maxLength: 8 })
          .filter((w) => w.some((x) => x > 0)),
        (amount, weights) => {
          const total = money(amount, "USD");
          const parts = allocate(total, weights);
          const partsSum = parts.reduce((acc, p) => acc + p.amountMinor, 0n);
          expect(partsSum).toBe(amount);
          // Ninguna parte se aleja más de 1 centésimo de su valor exacto.
          const wSum = BigInt(weights.reduce((a, b) => a + b, 0));
          parts.forEach((p, i) => {
            const exactTimesSum = amount * BigInt(weights[i] ?? 0);
            const diff = p.amountMinor * wSum - exactTimesSum;
            expect(diff < 0n ? -diff : diff).toBeLessThan(wSum);
          });
        },
      ),
    );
  });
});
