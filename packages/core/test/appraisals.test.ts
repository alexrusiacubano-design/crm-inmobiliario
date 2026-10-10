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

describe("cálculo de tasación", () => {
  it("homogeneiza por construcción, ubicación y oferta", () => {
    const r = computeAppraisal({
      area: 100,
      currency: "USD",
      offerDiscountBp: 1000,
      comparables: [
        { reference: "A", m2: 100, price: 200000, construction: 0, location: 0, kind: "real" },
        // oferta: −10 % → 2.000/m²
        { reference: "B", m2: 50, price: 111111.11, construction: 0, location: 0, kind: "offer" },
        // mejor construcción (×0,93) y peor ubicación (×1,07)
        { reference: "C", m2: 80, price: 160000, construction: 1, location: -1, kind: "real" },
        { reference: "vacío", m2: null, price: null, construction: 0, location: 0, kind: "real" },
      ],
    });
    expect(r.count).toBe(3);
    expect(r.rows[3]?.valid).toBe(false);
    expect(r.rows[2]?.unitAdjusted).toBeCloseTo(2000 * 0.93 * 1.07, 5);
    expect(r.value).toBe(Math.round(((2000 + 2000 + 2000 * 0.93 * 1.07) / 3) * 100 / 100) * 100);
    expect(r.min).toBeLessThan(r.value ?? 0);
    expect(r.max).toBeGreaterThan(r.value ?? 0);
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
    expect(view.finalValue).toBe(view.result.value);

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
      await setPrices(h.db, admin, { propertyId: p.id, prices: [{ operation: "sale", currency: "USD", list: price }] });
      await changePropertyStatus(h.db, admin, { propertyId: p.id, status: "available" });
    }
    const m = await marketComparator(h.db, admin, { operation: "sale", propertyType: "apartment" });
    expect(m.rows).toHaveLength(2);
    expect(m.stats.offer?.average).toBe((2000 + 2400) / 2);
    const comps = await comparablesFromProperties(h.db, admin, [m.rows[0]?.code ?? ""], { operation: "sale" });
    expect(comps[0]?.kind).toBe("offer");
    expect(comps[0]?.m2).toBeGreaterThan(0);
  });
});
