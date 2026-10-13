import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type DbHandle } from "@crm/db";
import { seedGeoUruguay } from "@crm/db/seed";
import { computeAppraisal } from "@crm/shared/appraisal";
import { parseLocaleNumber } from "@crm/shared/validation/appraisal";
import {
  changePropertyStatus,
  createProperty,
  deleteAppraisal,
  ForbiddenError,
  getAppraisal,
  listAppraisals,
  marketComparator,
  comparablesFromProperties,
  saveAppraisal,
  setPrices,
} from "../src";
import { createTestOrg, ctxFor, freshDb, type TestOrg } from "./fixtures";

let h: DbHandle;
let org: TestOrg;

beforeAll(async () => {
  h = await freshDb();
  await seedGeoUruguay(h.db);
  org = await createTestOrg(h.db, "tas", {
    admin: { roleKey: "admin" },
    agenteA: { roleKey: "agent", inTeam: true },
    agenteB: { roleKey: "agent" },
  });
});
afterAll(async () => {
  await h.pool.end();
});

describe("cálculo de tasación (método metrológico)", () => {
  const comps = [
    { reference: "A1", m2: 500, construction: 2, location: 2, kind: "real" as const, price: 400000 },
    { reference: "A2", m2: 520, construction: 3, location: 1, kind: "real" as const, price: 395000 },
    { reference: "A3", m2: 480, construction: 1, location: 1, kind: "real" as const, price: 375000 },
    { reference: "A4", m2: 560, construction: 2, location: 3, kind: "real" as const, price: 450000 },
  ];
  it("matriz K, coeficientes de ajuste, valor probable y rango", () => {
    const r = computeAppraisal({
      subject: { m2: 564, construction: 2, location: 1 },
      offerDiscountBp: 0,
      comparables: [
        ...comps,
        { reference: "vacío", m2: null, construction: null, location: null, kind: "real", price: null },
      ],
    });
    expect(r.count).toBe(4);
    expect(r.rows[4]?.valid).toBe(false);
    expect(r.k?.constant).toBeCloseTo(81666.67, 1);
    expect(r.k?.m2).toBeCloseTo(583.333, 2);
    expect(r.k?.construction).toBeCloseTo(-1666.67, 1);
    expect(r.k?.location).toBeCloseTo(15000, 1);
    expect(r.rows[0]?.coefficient).toBeCloseTo(1.0523, 3);
    expect(r.rows[3]?.adjusted).toBeCloseTo(422178, -1);
    expect(r.probable).toBeCloseTo(421917, -1);
    expect(r.uncertainty).toBeCloseTo(0.0117, 4);
    expect(r.min).toBeLessThan(r.probable ?? 0);
    expect(r.max).toBeGreaterThan(r.probable ?? 0);
    // K negativo en construcción: causa probable A2 (más construcción, menos valor por m²)
    expect(r.warnings).toEqual([{ variable: "construction", cause: 1 }]);
  });
  it("reproduce la tasación de referencia (Dalmiro Costa 4618)", () => {
    const r = computeAppraisal({
      subject: { m2: 495, construction: 2, location: 1 },
      offerDiscountBp: 0,
      comparables: [
        { reference: "A1", m2: 475, construction: 2, location: 3, kind: "real", price: 460000 },
        { reference: "A2", m2: 405, construction: 1, location: 3, kind: "real", price: 418500 },
        { reference: "A3", m2: 445, construction: 2, location: 1, kind: "real", price: 391500 },
        { reference: "A4", m2: 400, construction: 3, location: 2, kind: "real", price: 391500 },
      ],
    });
    expect(r.k?.constant).toBeCloseTo(105269.23, 1);
    expect(r.k?.location).toBeCloseTo(25509.62, 1);
    expect(r.rows[0]?.coefficient).toBeCloseTo(0.9116, 4);
    expect(r.probable).toBeCloseTo(417797, -1);
    expect(r.stdDev).toBeCloseTo(2817, -1);
    expect(r.uncertainty).toBeCloseTo(0.0479, 4);
    expect(r.min).toBeCloseTo(397792, -2);
    expect(r.max).toBeCloseTo(437802, -2);
  });
  it("con pocos antecedentes reduce el modelo sin romperse", () => {
    const r = computeAppraisal({
      subject: { m2: 100, construction: 3, location: 3 },
      offerDiscountBp: 1000,
      comparables: [{ reference: "", m2: 50, construction: 3, location: 3, kind: "offer", price: 100000 }],
    });
    expect(r.k).toBeNull();
    expect(r.probable).toBeCloseTo(180000, 0); // 100.000 − 10 % de oferta, ×2 por m²
  });
  it("interpreta números con formato uruguayo", () => {
    expect(parseLocaleNumber("120.000")).toBe(120000);
    expect(parseLocaleNumber("1.250,5")).toBe(1250.5);
    expect(parseLocaleNumber("85.5")).toBe(85.5);
  });
});

describe("tasaciones independientes", () => {
  it("se crean sin propiedad, se recalculan en el servidor y respetan el alcance", async () => {
    const a = await ctxFor(h.db, org, "agenteA");
    const row = await saveAppraisal(h.db, a, {
      title: "Apartamento de un cliente",
      propertyType: "apartment",
      operation: "sale",
      builtArea: "80",
      currency: "USD",
      comparables: [
        { reference: "X", m2: "70", price: "140.000", kind: "real" },
        { reference: "Y", m2: 90, price: 180000, kind: "real", construction: "1" },
      ],
    });
    expect(row.code).toMatch(/^TAS-\d{6}$/);
    expect(row.propertyId).toBeNull();
    const view = await getAppraisal(h.db, a, row.id);
    expect(view.result.count).toBe(2);
    expect(view.finalValue).toBe(view.result.probable);

    const updated = await saveAppraisal(h.db, a, {
      ...view,
      id: row.id,
      builtArea: 80,
      totalArea: null,
      comparables: view.comparables,
      adoptedValue: 165000,
      status: "final",
    });
    expect(updated.status).toBe("final");
    expect((await getAppraisal(h.db, a, row.id)).finalValue).toBe(165000);

    const b = await ctxFor(h.db, org, "agenteB");
    expect((await listAppraisals(h.db, b, {})).items.some((i) => i.id === row.id)).toBe(false);
    await expect(getAppraisal(h.db, b, row.id)).rejects.toBeInstanceOf(ForbiddenError);
    const admin = await ctxFor(h.db, org, "admin");
    expect((await listAppraisals(h.db, admin, { q: "cliente" })).items).toHaveLength(1);
    await deleteAppraisal(h.db, a, row.id);
    expect((await listAppraisals(h.db, admin, {})).items).toHaveLength(0);
  });

  it("el comparador calcula US$/m² con propiedades del CRM", async () => {
    const admin = await ctxFor(h.db, org, "admin");
    for (const [area, price] of [
      [100, "200000"],
      [50, "120000"],
    ] as const) {
      const p = await createProperty(h.db, admin, {
        type: "apartment",
        operations: ["sale"],
        title: `Apto ${area}`,
        builtArea: String(area),
      });
      await setPrices(h.db, admin, {
        propertyId: p.id,
        prices: [{ operation: "sale", currency: "USD", list: price }],
      });
      await changePropertyStatus(h.db, admin, { propertyId: p.id, status: "available" });
    }
    const m = await marketComparator(h.db, admin, { operation: "sale", propertyType: "apartment" });
    expect(m.rows).toHaveLength(2);
    expect(m.stats.offer?.average).toBe((2000 + 2400) / 2);
    const comps = await comparablesFromProperties(h.db, admin, [m.rows[0]?.code ?? ""], {
      operation: "sale",
    });
    expect(comps[0]?.kind).toBe("offer");
    expect(comps[0]?.m2).toBeGreaterThan(0);
  });
});
