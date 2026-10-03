import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { locality, neighborhood, rentPayment, type DbHandle } from "@crm/db";
import { seedGeoUruguay } from "@crm/db/seed";
import {
  addChargeLine,
  applyAdjustment,
  changePropertyStatus,
  changeSettlementStatus,
  ConflictError,
  createContact,
  createContract,
  createLead,
  createProperty,
  createSettlement,
  ForbiddenError,
  generateCharges,
  getCharge,
  listCharges,
  listSettlements,
  overdueCharges,
  registerPayment,
  setPropertyOwners,
  ValidationError,
  voidPayment,
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
  org = await createTestOrg(h.db, "bill", {
    admin: { roleKey: "admin" },
    adm: { roleKey: "rental_admin" },
    agenteA: { roleKey: "agent", inTeam: true },
    contable: { roleKey: "accounting" },
  });
});
afterAll(async () => {
  await h.pool.end();
});

async function setup(startDate: string) {
  const a = await ctxFor(h.db, org, "agenteA");
  const adm = await ctxFor(h.db, org, "adm");
  const p = await createProperty(h.db, a, {
    type: "apartment",
    operations: ["rent"],
    title: "Apto",
    localityId: geo.localityId,
    neighborhoodId: geo.neighborhoodId,
  });
  await changePropertyStatus(h.db, a, { propertyId: p.id, status: "available" });
  const o1 = (await createContact(h.db, a, { firstName: "Pro", lastName: "Uno" })).contact;
  const o2 = (await createContact(h.db, a, { firstName: "Pro", lastName: "Dos" })).contact;
  await setPropertyOwners(h.db, a, {
    propertyId: p.id,
    owners: [
      { contactId: o1.id, sharePercent: "50" },
      { contactId: o2.id, sharePercent: "50" },
    ],
  });
  const { lead } = await createLead(h.db, a, {
    operation: "rent",
    source: "portal",
    contact: { firstName: "Inqui", lastName: Math.random().toString(36).slice(2, 7) },
  });
  const c = await createContract(h.db, adm, {
    propertyId: p.id,
    tenantContactId: lead.contactId,
    startDate,
    months: 24,
    rent: "30000",
    paymentDay: 10,
    adminFeePercent: "6",
  });
  return { adm, c };
}

describe("cobros", () => {
  it("genera cuotas (prorrateo del primer mes, idempotente) y usa el alquiler ajustado", async () => {
    const { adm, c } = await setup("2026-01-16");
    const jan = await generateCharges(h.db, adm, { period: "2026-01" });
    expect(jan.created).toBeGreaterThanOrEqual(1);
    const again = await generateCharges(h.db, adm, { period: "2026-01" });
    expect(again.created).toBe(0);
    const list = await listCharges(h.db, adm, { period: "2026-01", contractId: c.id }, "2026-01-05");
    expect(list.items[0]?.totalMinor).toBe(1_548_400n); // 30.000 × 16/31 = 15.483,87 → 15.484
    await applyAdjustment(h.db, adm, { contractId: c.id, effectiveFrom: "2026-03-01", percent: "10" });
    await generateCharges(h.db, adm, { period: "2026-03" });
    const mar = await listCharges(h.db, adm, { period: "2026-03", contractId: c.id }, "2026-03-01");
    expect(mar.items[0]?.totalMinor).toBe(3_300_000n);
    expect(mar.items[0]?.dueDate).toBe("2026-03-10");
  });

  it("pagos parciales, morosidad, contra-asiento y liquidación con comisión", async () => {
    const { adm, c } = await setup("2026-05-01");
    await generateCharges(h.db, adm, { period: "2026-06" });
    const [ch] = (await listCharges(h.db, adm, { period: "2026-06", contractId: c.id }, "2026-06-01")).items;
    if (!ch) throw new Error("sin cuota");
    await addChargeLine(h.db, adm, { chargeId: ch.id, kind: "common_expenses", amount: "5000" });
    await registerPayment(h.db, adm, {
      chargeId: ch.id,
      amount: "20000",
      paidAt: "2026-06-08",
      method: "transfer",
    });
    let one = await getCharge(h.db, adm, ch.id, "2026-06-09");
    expect(one.charge).toMatchObject({ totalMinor: 3_500_000n, paidMinor: 2_000_000n, status: "partial" });
    one = await getCharge(h.db, adm, ch.id, "2026-06-15");
    expect(one.charge.status).toBe("overdue");
    expect((await overdueCharges(h.db, adm, "2026-06-15"))?.items.some((x) => x.id === ch.id)).toBe(true);
    expect(
      await catchErr(registerPayment(h.db, adm, { chargeId: ch.id, amount: "20000", paidAt: "2026-06-16" })),
    ).toBeInstanceOf(ValidationError); // supera el saldo

    // Contra-asiento (contabilidad puede anular).
    const cont = await ctxFor(h.db, org, "contable");
    const payId = one.payments[0]?.id ?? "";
    await voidPayment(h.db, cont, { paymentId: payId, reason: "Transferencia rechazada" });
    expect(await catchErr(voidPayment(h.db, cont, { paymentId: payId, reason: "otra vez" }))).toBeInstanceOf(
      ConflictError,
    );
    await expect(
      h.db.execute(sql`update rent_payment set amount_minor = 1 where id = ${payId}`),
    ).rejects.toThrow();
    await registerPayment(h.db, adm, {
      chargeId: ch.id,
      amount: "35000",
      paidAt: "2026-06-20",
      method: "cash",
    });
    expect((await getCharge(h.db, adm, ch.id, "2026-06-21")).charge.status).toBe("paid");

    // Liquidación: 35.000 cobrado − 6 % de 30.000 − 1.000 de arreglo = 32.200, mitad a cada uno.
    const s = await createSettlement(h.db, cont, {
      chargeId: ch.id,
      deductions: [{ description: "Arreglo de canilla", amount: "1000" }],
    });
    expect(s).toMatchObject({ feeMinor: 180_000n, netMinor: 3_220_000n });
    expect(s.shares.map((x) => x.amountMinor)).toEqual(["1610000", "1610000"]);
    expect(await catchErr(createSettlement(h.db, cont, { chargeId: ch.id }))).toBeInstanceOf(ConflictError);
    const pays = await h.db.select().from(rentPayment).where(eq(rentPayment.chargeId, ch.id));
    const lastPay = pays.find((p) => p.amountMinor === 3_500_000n);
    expect(
      await catchErr(voidPayment(h.db, cont, { paymentId: lastPay?.id ?? "", reason: "error" })),
    ).toBeInstanceOf(ConflictError); // liquidada
    expect(
      await catchErr(changeSettlementStatus(h.db, cont, { id: s.id, status: "paid", paidAt: "2026-06-25" })),
    ).toBeInstanceOf(ConflictError); // falta aprobar
    await changeSettlementStatus(h.db, cont, { id: s.id, status: "approved" });
    await changeSettlementStatus(h.db, cont, {
      id: s.id,
      status: "paid",
      paidAt: "2026-06-25",
      reference: "TRF 991",
    });
    const list = await listSettlements(h.db, cont, { status: "paid" });
    expect(list.items.some((x) => x.id === s.id)).toBe(true);
    expect(list.totals.fees.UYU).toBeGreaterThanOrEqual(180_000n);
  });

  it("un agente no ve cobros; contabilidad no genera cuotas", async () => {
    const a = await ctxFor(h.db, org, "agenteA");
    expect(await catchErr(listCharges(h.db, a, {}, "2026-06-01"))).toBeInstanceOf(ForbiddenError);
    const cont = await ctxFor(h.db, org, "contable");
    expect(await catchErr(generateCharges(h.db, cont, { period: "2026-07" }))).toBeInstanceOf(ForbiddenError);
  });
});
