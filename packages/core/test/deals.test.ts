import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dealCommission, lead, locality, neighborhood, property, type DbHandle } from "@crm/db";
import { seedGeoUruguay } from "@crm/db/seed";
import {
  agentFinance,
  careerStatus,
  changeDealStage,
  changePropertyStatus,
  collectCommission,
  ConflictError,
  createDeal,
  createLead,
  createProperty,
  ForbiddenError,
  getDeal,
  listDeals,
  NotFoundError,
  saveCommissionPlan,
  setDealCommissions,
  setDealParticipants,
  setPrices,
  ValidationError,
} from "../src";
import { canTransitionDeal } from "@crm/shared";
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
  org = await createTestOrg(h.db, "deals", {
    admin: { roleKey: "admin" },
    director: { roleKey: "director" },
    agenteA: { roleKey: "agent", inTeam: true },
    agenteB: { roleKey: "agent", branch: "second" },
    contable: { roleKey: "accounting" },
  });
});
afterAll(async () => {
  await h.pool.end();
});

async function listedProperty(key: string, operations: ("sale" | "rent")[] = ["sale"]) {
  const ctx = await ctxFor(h.db, org, key);
  const p = await createProperty(h.db, ctx, {
    type: "apartment",
    operations,
    title: "Apartamento para operación",
    localityId: geo.localityId,
    neighborhoodId: geo.neighborhoodId,
    commissionPercent: "3",
  });
  await setPrices(h.db, ctx, {
    propertyId: p.id,
    prices: operations.map((op) => ({
      operation: op,
      currency: op === "sale" ? "USD" : "UYU",
      list: op === "sale" ? "200000" : "30000",
    })),
  }).catch(() => undefined);
  await changePropertyStatus(h.db, ctx, { propertyId: p.id, status: "available" });
  return p;
}

async function buyer(key: string) {
  const ctx = await ctxFor(h.db, org, key);
  return (
    await createLead(h.db, ctx, {
      operation: "buy",
      source: "portal",
      contact: { firstName: "Comprador", lastName: Math.random().toString(36).slice(2, 7) },
    })
  ).lead;
}

describe("transiciones de operaciones", () => {
  it("avanza, retrocede un paso, se cae desde abierta y no se reabre cerrada", () => {
    expect(canTransitionDeal("negotiation", "reserved")).toBe(true);
    expect(canTransitionDeal("negotiation", "closed")).toBe(true);
    expect(canTransitionDeal("notary", "reserved")).toBe(true);
    expect(canTransitionDeal("signed", "negotiation")).toBe(false);
    expect(canTransitionDeal("reserved", "fallen")).toBe(true);
    expect(canTransitionDeal("closed", "fallen")).toBe(false);
    expect(canTransitionDeal("fallen", "negotiation")).toBe(true);
  });
});

describe("operaciones", () => {
  it("crea con código OP, participantes por defecto, honorario sugerido y propiedad en negociación", async () => {
    const a = await ctxFor(h.db, org, "agenteA");
    const p = await listedProperty("agenteA");
    const l = await buyer("agenteA");
    const d = await createDeal(h.db, a, {
      propertyId: p.id,
      operation: "sale",
      clientContactId: l.contactId,
      leadId: l.id,
      currency: "USD",
      price: "190.000",
    });
    expect(d.code).toMatch(/^OP-\d{6}$/);
    const full = await getDeal(h.db, a, d.id);
    expect(full.participants).toHaveLength(1);
    expect(full.participants[0]?.shareBasisPoints).toBe(10_000);
    expect(full.commissions).toHaveLength(1);
    expect(full.commissions[0]?.side).toBe("seller");
    expect(full.commissions[0]?.amountMinor).toBe(570_000n);
    const [pp] = await h.db.select().from(property).where(eq(property.id, p.id));
    expect(pp?.status).toBe("negotiating");
  });

  it("valida operación de la propiedad y alcance", async () => {
    const a = await ctxFor(h.db, org, "agenteA");
    const b = await ctxFor(h.db, org, "agenteB");
    const p = await listedProperty("agenteA", ["rent"]);
    const l = await buyer("agenteA");
    expect(
      await catchErr(
        createDeal(h.db, a, {
          propertyId: p.id,
          operation: "sale",
          clientContactId: l.contactId,
          price: "1000",
        }),
      ),
    ).toBeInstanceOf(ValidationError);
    // B no ve al cliente de A.
    expect(
      await catchErr(
        createDeal(h.db, b, {
          propertyId: p.id,
          operation: "rent",
          clientContactId: l.contactId,
          price: "30000",
          currency: "UYU",
        }),
      ),
    ).toBeInstanceOf(NotFoundError);
    const d = await createDeal(h.db, a, {
      propertyId: p.id,
      operation: "rent",
      clientContactId: l.contactId,
      price: "30000",
      currency: "UYU",
    });
    expect(await catchErr(getDeal(h.db, b, d.id))).toBeInstanceOf(NotFoundError);
    const list = await listDeals(h.db, b, {});
    expect(list.items.some((x) => x.id === d.id)).toBe(false);
  });

  it("reserva, cierra (solo con deal.close), marca vendida, gana el lead y fija el porcentaje", async () => {
    const a = await ctxFor(h.db, org, "agenteA");
    const dir = await ctxFor(h.db, org, "director");
    const p = await listedProperty("agenteA");
    const l = await buyer("agenteA");
    const d = await createDeal(h.db, a, {
      propertyId: p.id,
      operation: "sale",
      clientContactId: l.contactId,
      leadId: l.id,
      price: "200000",
    });
    await changeDealStage(h.db, a, { id: d.id, stage: "reserved" });
    let [pp] = await h.db.select().from(property).where(eq(property.id, p.id));
    expect(pp?.status).toBe("reserved");
    await changeDealStage(h.db, a, { id: d.id, stage: "notary" });
    expect(await catchErr(changeDealStage(h.db, a, { id: d.id, stage: "closed" }))).toBeInstanceOf(
      ForbiddenError,
    );
    await changeDealStage(h.db, dir, { id: d.id, stage: "closed", closedAt: "2026-09-20" });
    [pp] = await h.db.select().from(property).where(eq(property.id, p.id));
    expect(pp?.status).toBe("sold");
    const [ll] = await h.db.select().from(lead).where(eq(lead.id, l.id));
    expect(ll?.status).toBe("won");
    const full = await getDeal(h.db, a, d.id);
    expect(full.participants[0]?.agentRateBasisPoints).toBe(4000);
    expect(
      await catchErr(changeDealStage(h.db, dir, { id: d.id, stage: "fallen", fallenReason: "x" })),
    ).toBeInstanceOf(ConflictError);
  });

  it("se cae: vuelve a publicar la propiedad y anula honorarios pendientes", async () => {
    const a = await ctxFor(h.db, org, "agenteA");
    const p = await listedProperty("agenteA");
    const l = await buyer("agenteA");
    const d = await createDeal(h.db, a, {
      propertyId: p.id,
      operation: "sale",
      clientContactId: l.contactId,
      price: "150000",
    });
    expect(await catchErr(changeDealStage(h.db, a, { id: d.id, stage: "fallen" }))).toBeInstanceOf(
      ValidationError,
    );
    await changeDealStage(h.db, a, { id: d.id, stage: "fallen", fallenReason: "No consiguió el crédito" });
    const [pp] = await h.db.select().from(property).where(eq(property.id, p.id));
    expect(pp?.status).toBe("available");
    const cs = await h.db.select().from(dealCommission).where(eq(dealCommission.dealId, d.id));
    expect(cs.every((c) => c.status === "cancelled")).toBe(true);
  });

  it("reparto: debe sumar 100 %; cobro solo con commission.manage y no se modifica cobrado", async () => {
    const a = await ctxFor(h.db, org, "agenteA");
    const b = await ctxFor(h.db, org, "agenteB");
    const cont = await ctxFor(h.db, org, "contable");
    const p = await listedProperty("agenteA");
    const l = await buyer("agenteA");
    const d = await createDeal(h.db, a, {
      propertyId: p.id,
      operation: "sale",
      clientContactId: l.contactId,
      price: "100000",
    });
    expect(
      await catchErr(
        setDealParticipants(h.db, a, {
          dealId: d.id,
          participants: [
            { userId: a.userId, role: "seller_agent", share: "60" },
            { userId: b.userId, role: "collaborator", share: "30" },
          ],
        }),
      ),
    ).toBeInstanceOf(ValidationError);
    await setDealParticipants(h.db, a, {
      dealId: d.id,
      participants: [
        { userId: a.userId, role: "seller_agent", share: "60" },
        { userId: b.userId, role: "collaborator", share: "40" },
      ],
    });
    await setDealCommissions(h.db, a, {
      dealId: d.id,
      lines: [
        { side: "seller", currency: "USD", amount: "3000", dueDate: "2026-10-15" },
        { side: "buyer", currency: "USD", amount: "3000" },
      ],
    });
    // B participa: ve la operación aunque sea de A.
    const seenByB = await getDeal(h.db, b, d.id);
    expect(seenByB.commissions).toHaveLength(2);
    const seller = seenByB.commissions.find((c) => c.side === "seller");
    if (!seller) throw new Error("seller");
    expect(
      await catchErr(collectCommission(h.db, a, { commissionId: seller.id, collectedAt: "2026-09-25" })),
    ).toBeInstanceOf(ForbiddenError);
    await collectCommission(h.db, cont, {
      commissionId: seller.id,
      collectedAt: "2026-09-25",
      reference: "Recibo 1",
    });
    expect(
      await catchErr(
        setDealCommissions(h.db, a, {
          dealId: d.id,
          lines: [{ side: "seller", currency: "USD", amount: "2000" }],
        }),
      ),
    ).toBeInstanceOf(ConflictError);

    // Finanzas de A: 3000 × 60 % × 40 % = 720 cobrados; 720 pendientes.
    const fin = await agentFinance(h.db, a, { today: "2026-09-28" });
    expect(fin.collectedMonth.USD).toBe(72_000n);
    expect(fin.pending.USD).toBeGreaterThanOrEqual(72_000n);
    expect(fin.lines.find((x) => x.id === seller.id)?.teamWork).toBe(true);
    expect(fin.lines.find((x) => x.id === seller.id)?.bothSides).toBe(true);
    expect(fin.monthly).toHaveLength(12);
    expect(await catchErr(agentFinance(h.db, a, { userId: b.userId, today: "2026-09-28" }))).toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("plan de carrera configurable y progreso", async () => {
    const admin = await ctxFor(h.db, org, "admin");
    const a = await ctxFor(h.db, org, "agenteA");
    expect(await catchErr(saveCommissionPlan(h.db, a, { tiers: [], uyuPerUsd: "40" }))).toBeInstanceOf(
      ForbiddenError,
    );
    expect(
      await catchErr(
        saveCommissionPlan(h.db, admin, {
          tiers: [
            { name: "Uno", minBilled: "0", rate: "40" },
            { name: "Dos", minBilled: "0", rate: "45" },
          ],
          uyuPerUsd: "40",
        }),
      ),
    ).toBeInstanceOf(ValidationError);
    await saveCommissionPlan(h.db, admin, {
      tiers: [
        { name: "Uno", minBilled: "0", rate: "40" },
        { name: "Dos", minBilled: "1.000", rate: "45" },
        { name: "Tres", minBilled: "50.000", rate: "50" },
      ],
      uyuPerUsd: "40",
    });
    const st = await careerStatus(h.db, a);
    // A facturó 3000 × 60 % = 1800 USD → escalón "Dos".
    expect(st.billedUsdMinor).toBe(180_000n);
    expect(st.tier?.name).toBe("Dos");
    expect(st.next?.name).toBe("Tres");
    expect(st.remainingUsdMinor).toBe(5_000_000n - 180_000n);
  });
});
