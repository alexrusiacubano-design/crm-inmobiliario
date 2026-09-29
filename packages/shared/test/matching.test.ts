import { describe, expect, it } from "vitest";
import {
  comparableConfidence,
  convertMinor,
  medianPricePerM2,
  monthlyExpenseMinor,
  parseRate,
  scoreMatch,
  type MatchProfile,
  type MatchProperty,
} from "../src/matching";

const rate = parseRate("40");

const profile: MatchProfile = {
  operation: "buy",
  propertyTypes: ["apartment"],
  departmentIds: [],
  localityIds: [],
  neighborhoodIds: [10],
  currency: "USD",
  priceMinMinor: null,
  priceMaxMinor: 200_000_00n,
  bedroomsMin: 2,
  bathroomsMin: null,
  garagesMin: null,
  areaMin: 60,
  commonExpensesMaxMinor: null,
  commonExpensesCurrency: "UYU",
  pets: false,
  furnished: "any",
  features: [],
};

const prop: MatchProperty = {
  type: "apartment",
  status: "published",
  operations: ["sale"],
  departmentId: 1,
  localityId: 2,
  neighborhoodId: 10,
  bedrooms: 2,
  bathrooms: 1,
  garages: 0,
  area: "65.00",
  petsAllowed: false,
  furnished: false,
  features: [],
  price: { currency: "USD", amountMinor: 190_000_00n },
  commonExpenses: null,
};

describe("scoreMatch", () => {
  it("una propiedad que cumple todo tiene 100", () => {
    const r = scoreMatch(profile, prop, rate);
    expect(r.eligible).toBe(true);
    expect(r.score).toBe(100);
    expect(r.reasons.every((x) => x.kind === "ok")).toBe(true);
  });

  it("excluye por operación, estado, tipo, zona y precio", () => {
    expect(scoreMatch(profile, { ...prop, operations: ["rent"] }, rate).rejectedBy).toBe("operación");
    expect(scoreMatch(profile, { ...prop, status: "reserved" }, rate).rejectedBy).toBe("estado");
    expect(scoreMatch(profile, { ...prop, type: "house" }, rate).rejectedBy).toBe("tipo");
    expect(scoreMatch(profile, { ...prop, neighborhoodId: 11 }, rate).rejectedBy).toBe("zona");
    const expensive = { ...prop, price: { currency: "USD" as const, amountMinor: 221_000_00n } };
    expect(scoreMatch(profile, expensive, rate).rejectedBy).toBe("precio");
  });

  it("la zona también matchea por localidad o departamento", () => {
    const p = { ...profile, neighborhoodIds: [], localityIds: [2] };
    expect(scoreMatch(p, { ...prop, neighborhoodId: 99 }, rate).eligible).toBe(true);
  });

  it("hasta 10 % arriba del presupuesto entra con penalización", () => {
    const r = scoreMatch(profile, { ...prop, price: { currency: "USD", amountMinor: 215_000_00n } }, rate);
    expect(r.eligible).toBe(true);
    expect(r.score).toBe(85);
  });

  it("convierte precios en pesos a la moneda de la búsqueda", () => {
    const r = scoreMatch(profile, { ...prop, price: { currency: "UYU", amountMinor: 7_600_000_00n } }, rate);
    expect(r.eligible).toBe(true);
    expect(r.reasons.some((x) => x.text.includes("convertido"))).toBe(true);
  });

  it("un dormitorio menos penaliza; dos menos excluye", () => {
    expect(scoreMatch(profile, { ...prop, bedrooms: 1 }, rate).score).toBe(85);
    const p = { ...profile, bedroomsMin: 3 };
    expect(scoreMatch(p, { ...prop, bedrooms: 1 }, rate).rejectedBy).toBe("dormitorios");
  });

  it("en alquiler, mascotas y amueblado importan", () => {
    const rent: MatchProfile = { ...profile, operation: "rent", priceMaxMinor: null, pets: true, furnished: "yes" };
    const rp: MatchProperty = { ...prop, operations: ["rent"], price: null };
    expect(scoreMatch(rent, rp, rate).rejectedBy).toBe("mascotas");
    const r = scoreMatch(rent, { ...rp, petsAllowed: true }, rate);
    expect(r.eligible).toBe(true);
    expect(r.score).toBe(95); // no amueblada
  });

  it("debajo del puntaje mínimo no se sugiere", () => {
    const p: MatchProfile = {
      ...profile,
      bathroomsMin: 3,
      garagesMin: 2,
      areaMin: 200,
      features: ["pool", "barbecue", "terrace"],
    };
    const r = scoreMatch(p, { ...prop, bedrooms: 1, price: { currency: "USD", amountMinor: 210_000_00n } }, rate);
    expect(r.score).toBeLessThan(50);
    expect(r.eligible).toBe(false);
  });
});

describe("conversión y comparables", () => {
  it("convierte sin floats y redondea", () => {
    expect(parseRate("40,25")).toBe(402_500n);
    expect(convertMinor(100n, "USD", "UYU", parseRate("40,25"))).toBe(4_025n);
    expect(convertMinor(4_025n, "UYU", "USD", parseRate("40,25"))).toBe(100n);
    expect(() => parseRate("0")).toThrow();
  });

  it("gastos a valor mensual", () => {
    expect(monthlyExpenseMinor(1200n, "annual")).toBe(100n);
    expect(monthlyExpenseMinor(200n, "bimonthly")).toBe(100n);
    expect(monthlyExpenseMinor(200n, "one_time")).toBeNull();
  });

  it("mediana de precio por m²", () => {
    expect(medianPricePerM2([])).toBeNull();
    expect(
      medianPricePerM2([
        { priceMinor: 100_000_00n, areaM2: 50 }, // 2000/m²
        { priceMinor: 150_000_00n, areaM2: 60 }, // 2500/m²
        { priceMinor: 300_000_00n, areaM2: 100 }, // 3000/m²
      ]),
    ).toBe(2_500_00n);
    expect(
      medianPricePerM2([
        { priceMinor: 100_000_00n, areaM2: 50 },
        { priceMinor: 150_000_00n, areaM2: 50 },
      ]),
    ).toBe(2_500_00n);
    expect(comparableConfidence(2)).toBe("low");
    expect(comparableConfidence(6)).toBe("high");
  });
});
