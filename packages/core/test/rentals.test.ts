import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { locality, neighborhood, property, rentalContract, rentalContractRent, type DbHandle } from "@crm/db";
import { seedGeoUruguay } from "@crm/db/seed";
import {
  activeContractFor,
  applyAdjustment,
  changeDealStage,
  changePropertyStatus,
  closeContract,
  ConflictError,
  createContract,
  createDeal,
  createLead,
  createProperty,
  ForbiddenError,
  getContract,
  listContracts,
  NotFoundError,
  renewContract,
  rentalAlerts,
  setPrices,
  ValidationError,
} from "../src";
import { createTestOrg, ctxFor, freshDb, type TestOrg } from "./fixtures";

let h: DbHandle;
let org: TestOrg;
let geo: { localityId: number; neighborhoodId: number };

async function catchErr(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => null,
    (e: unknown) => e,
  );
}

beforeAll(async () => {
  h = await freshDb();
  await seedGeoUruguay(h.db);
  const [n] = await h.db
    .select({ localityId: locality.id, neighborhoodId: neighborhood.id })
    .from(neighborhood)
    .innerJoin(locality, eq(locality.id, neighborhood.localityId))
    .limit(1);
  if (!n) throw new Error("geo");
  geo = n;
  org = await createTestOrg(h.db, "rentals", {
    admin: { roleKey: "admin" },
    adm: { roleKey: "rental_admin" },
    agenteA: { roleKey: "agent", inTeam: true },
    contable: { roleKey: "accounting" },
  });
});
afterAll(async () => {
  await h.pool.end();
});

async function rentalSetup() {
  const a = await ctxFor(h.db, org, "agenteA");
  const p = await createProperty(h.db, a, {
    type: "apartment",
    operations: ["rent"],
    title: "Apto en alquiler",
    localityId: geo.localityId,
    neighborhoodId: geo.neighborhoodId,
  });
  await setPrices(h.db, a, {
    propertyId: p.id,
    prices: [{ operation: "rent", currency: "UYU", list: "25000" }],
  });
  await changePropertyStatus(h.db, a, { propertyId: p.id, status: "available" });
  const { lead } = await createLead(h.db, a, {
    operation: "rent",
    source: "portal",
    contact: { firstName: "Inqui", lastName: Math.random().toString(36).slice(2, 7) },
  });
  return { a, p, lead };
}

describe("contratos", () => {
  it("crea desde una operación de alquiler: fin, primer ajuste, historial y propiedad alquilada", async () => {
    const { a, p, lead } = await rentalSetup();
    const d = await createDeal(h.db, a, {
      propertyId: p.id,
      operation: "rent",
      clientContactId: lead.contactId,
      leadId: lead.id,
      currency: "UYU",
      price: "25000",
    });
    await changeDealStage(h.db, a, { id: d.id, stage: "reserved" });
    await changeDealStage(h.db, a, { id: d.id, stage: "notary" });
    await changeDealStage(h.db, a, { id: d.id, stage: "signed" });
    const adm = await ctxFor(h.db, org, "adm");
    expect(
      await catchErr(
        createContract(h.db, a, {
          propertyId: p.id,
          tenantContactId: lead.contactId,
          startDate: "2026-03-01",
          months: 24,
          rent: "25000",
        }),
      ),
    ).toBeInstanceOf(ForbiddenError); // el agente no gestiona contratos
    const c = await createContract(h.db, adm, {
      propertyId: p.id,
      tenantContactId: lead.contactId,
      dealId: d.id,
      startDate: "2026-03-01",
      months: 24,
      rent: "25.000",
      deposit: "50000",
      adminFeePercent: "6",
      guaranteeNote: "ANDA",
    });
    expect(c).toMatchObject({
      code: "CTR-000001",
      endDate: "2028-02-29",
      nextAdjustmentAt: "2027-03-01",
      adminFeeBasisPoints: 600,
    });
    const [pr] = await h.db.select().from(property).where(eq(property.id, p.id));
    expect(pr?.status).toBe("rented");
    expect(
      await catchErr(
        createContract(h.db, adm, {
          propertyId: p.id,
          tenantContactId: lead.contactId,
          startDate: "2026-03-01",
          months: 12,
          rent: "1",
        }),
      ),
    ).toBeInstanceOf(ConflictError); // ya hay uno vigente
    expect((await activeContractFor(h.db, adm, p.id))?.code).toBe("CTR-000001");

    // Ajuste programado del 5,5 %.
    await applyAdjustment(h.db, adm, {
      contractId: c.id,
      effectiveFrom: "2027-03-01",
      percent: "5,5",
      note: "IPC",
    });
    const [after] = await h.db.select().from(rentalContract).where(eq(rentalContract.id, c.id));
    expect(after?.rentMinor).toBe(2_637_500n);
    expect(after?.nextAdjustmentAt).toBeNull(); // el siguiente caería después del fin
    const rents = await h.db.select().from(rentalContractRent).where(eq(rentalContractRent.contractId, c.id));
    expect(rents.map((r) => r.reason).sort()).toEqual(["adjustment", "initial"]);
    await expect(
      h.db.execute(sql`update rental_contract_rent set amount_minor = 1 where contract_id = ${c.id}`),
    ).rejects.toThrow();
    expect(
      await catchErr(
        applyAdjustment(h.db, adm, { contractId: c.id, effectiveFrom: "2030-01-01", percent: "3" }),
      ),
    ).toBeInstanceOf(ValidationError);

    // Renovación: nuevo contrato encadenado, el anterior queda renovado.
    const r = await renewContract(h.db, adm, { contractId: c.id, months: 12, newRent: "28000" });
    expect(r).toMatchObject({
      startDate: "2028-03-01",
      endDate: "2029-02-28",
      renewedFromId: c.id,
      rentMinor: 2_800_000n,
    });
    const full = await getContract(h.db, adm, r.id, "2028-03-10");
    expect(full.chain.map((x) => x.status)).toEqual(["renewed", "active"]);
    expect(full.rents.length).toBe(3); // inicial + ajuste + renovación
  });

  it("rescindir libera la propiedad; los avisos detectan vencimientos y ajustes", async () => {
    const { p, lead } = await rentalSetup();
    const adm = await ctxFor(h.db, org, "adm");
    const c = await createContract(h.db, adm, {
      propertyId: p.id,
      tenantContactId: lead.contactId,
      startDate: "2025-11-01",
      months: 12,
      rent: "20000",
      adjustmentMonths: 6,
    });
    expect(c.nextAdjustmentAt).toBe("2026-05-01");
    const alerts = await rentalAlerts(h.db, adm, "2026-09-15");
    expect(alerts?.expiring.some((x) => x.id === c.id)).toBe(true); // vence 31/10/2026
    expect(alerts?.adjustments.some((x) => x.id === c.id)).toBe(true); // ajuste atrasado
    const list = await listContracts(h.db, adm, { status: "expiring" }, "2026-09-15");
    expect(list.items.find((x) => x.id === c.id)?.alerts).toEqual(["expiring", "adjustment_overdue"]);

    expect(
      await catchErr(closeContract(h.db, adm, { contractId: c.id, kind: "terminated", date: "2026-09-30" })),
    ).toBeInstanceOf(ValidationError); // rescisión sin motivo
    await closeContract(h.db, adm, {
      contractId: c.id,
      kind: "terminated",
      date: "2026-09-30",
      reason: "Se muda al interior",
    });
    const [pr] = await h.db.select().from(property).where(eq(property.id, p.id));
    expect(pr?.status).toBe("available");
    expect(
      await catchErr(
        applyAdjustment(h.db, adm, { contractId: c.id, effectiveFrom: "2026-05-01", percent: "3" }),
      ),
    ).toBeInstanceOf(ConflictError);
  });

  it("contabilidad ve pero no gestiona; un agente no ve", async () => {
    const { p, lead } = await rentalSetup();
    const adm = await ctxFor(h.db, org, "adm");
    const c = await createContract(h.db, adm, {
      propertyId: p.id,
      tenantContactId: lead.contactId,
      startDate: "2026-01-01",
      months: 24,
      rent: "30000",
    });
    const cont = await ctxFor(h.db, org, "contable");
    expect((await getContract(h.db, cont, c.id, "2026-06-01")).canManage).toBe(false);
    expect(
      await catchErr(closeContract(h.db, cont, { contractId: c.id, kind: "ended", date: "2027-12-31" })),
    ).toBeInstanceOf(ForbiddenError);
    const a = await ctxFor(h.db, org, "agenteA");
    expect(await catchErr(getContract(h.db, a, c.id, "2026-06-01"))).toBeInstanceOf(NotFoundError);
  });
});
