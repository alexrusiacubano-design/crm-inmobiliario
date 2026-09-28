import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { locality, neighborhood, type DbHandle } from "@crm/db";
import { seedGeoUruguay } from "@crm/db/seed";
import {
  activityMetrics,
  changeDealStage,
  changePropertyStatus,
  closeEvent,
  closingMap,
  collectCommission,
  competition,
  createDeal,
  createEvent,
  createLead,
  createProperty,
  ForbiddenError,
  getDeal,
  saveGoals,
  setDealCommissions,
} from "../src";
import { createTestOrg, ctxFor, freshDb, type TestOrg } from "./fixtures";

let h: DbHandle;
let org: TestOrg;
// Día local de la organización (evita fallas cerca de medianoche UTC).
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Montevideo" }).format(new Date());

async function catchErr(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => null,
    (e: unknown) => e,
  );
}

beforeAll(async () => {
  h = await freshDb();
  await seedGeoUruguay(h.db);
  const [geo] = await h.db
    .select({ localityId: locality.id, neighborhoodId: neighborhood.id })
    .from(neighborhood)
    .innerJoin(locality, eq(locality.id, neighborhood.localityId))
    .limit(1);
  org = await createTestOrg(h.db, "perf", {
    admin: { roleKey: "admin" },
    director: { roleKey: "director" },
    supervisor: { roleKey: "supervisor", inTeam: true },
    agenteA: { roleKey: "agent", inTeam: true },
    agenteB: { roleKey: "agent", branch: "second" },
    contable: { roleKey: "accounting" },
  });
  // Actividad del agente A: una propiedad captada, una visita realizada, una operación cerrada y cobrada.
  const a = await ctxFor(h.db, org, "agenteA");
  const p = await createProperty(h.db, a, {
    type: "house",
    operations: ["sale"],
    title: "Casa con coordenadas",
    localityId: geo?.localityId,
    neighborhoodId: geo?.neighborhoodId,
    latitude: "-34.9115",
    longitude: "-56.1507",
  });
  await changePropertyStatus(h.db, a, { propertyId: p.id, status: "available" });
  const { lead } = await createLead(h.db, a, {
    operation: "buy",
    source: "portal",
    contact: { firstName: "Compra", lastName: "Dora" },
  });
  const v = await createEvent(h.db, a, {
    type: "visit",
    title: "Visita",
    startsAt: new Date(Date.now() - 60_000).toISOString(),
    propertyId: p.id,
    contactId: lead.contactId,
  });
  await closeEvent(h.db, a, { id: v.id, status: "done", outcome: "offer_intent" });
  const d = await createDeal(h.db, a, {
    propertyId: p.id,
    operation: "sale",
    clientContactId: lead.contactId,
    leadId: lead.id,
    price: "100000",
  });
  await setDealCommissions(h.db, a, {
    dealId: d.id,
    lines: [{ side: "seller", currency: "USD", amount: "5000" }],
  });
  await changeDealStage(h.db, a, { id: d.id, stage: "reserved" });
  const dir = await ctxFor(h.db, org, "director");
  await changeDealStage(h.db, dir, { id: d.id, stage: "closed", closedAt: today });
  const cont = await ctxFor(h.db, org, "contable");
  const full = await getDeal(h.db, cont, d.id);
  await collectCommission(h.db, cont, { commissionId: full.commissions[0]?.id ?? "", collectedAt: today });
});
afterAll(async () => {
  await h.pool.end();
});

describe("métricas del parte", () => {
  it("cuenta la actividad del período y compara contra la meta", async () => {
    const admin = await ctxFor(h.db, org, "admin");
    const a = await ctxFor(h.db, org, "agenteA");
    await saveGoals(h.db, admin, {
      userId: null,
      goals: [
        { metric: "visits_done", monthlyTarget: 4 },
        { metric: "properties_listed", monthlyTarget: 1 },
      ],
    });
    await saveGoals(h.db, admin, { userId: a.userId, goals: [{ metric: "visits_done", monthlyTarget: 8 }] });
    const r = await activityMetrics(h.db, a, { period: "month", today });
    const get = (m: string) => r.metrics.find((x) => x.metric === m);
    expect(get("visits_done")).toMatchObject({ value: 1, target: 8, goalSource: "user" });
    expect(get("properties_listed")).toMatchObject({ value: 1, target: 1, goalSource: "default" });
    expect(get("reservations")?.value).toBe(1);
    expect(get("signed")?.value).toBe(1);
    expect(get("sales_closed")?.value).toBe(1);
    expect(get("rentals_closed")?.value).toBe(0);
    expect(r.projected.USD).toBe(200_000n); // 5000 × 100 % × 40 %
    const rent = await activityMetrics(h.db, a, { period: "month", today, operation: "rent" });
    expect(rent.metrics.find((x) => x.metric === "sales_closed")?.value).toBe(0);
  });

  it("un agente no ve las métricas de otro; el supervisor sí las de su equipo; metas generales solo admin", async () => {
    const a = await ctxFor(h.db, org, "agenteA");
    const b = await ctxFor(h.db, org, "agenteB");
    const s = await ctxFor(h.db, org, "supervisor");
    expect(await catchErr(activityMetrics(h.db, b, { userId: a.userId, today }))).toBeInstanceOf(
      ForbiddenError,
    );
    const r = await activityMetrics(h.db, s, { userId: a.userId, today });
    expect(r.userId).toBe(a.userId);
    expect(await catchErr(saveGoals(h.db, a, { userId: null, goals: [] }))).toBeInstanceOf(ForbiddenError);
  });
});

describe("competencia", () => {
  it("suma puntos por reglas visibles y arma ranking de agentes y sucursales", async () => {
    const b = await ctxFor(h.db, org, "agenteB");
    const a = await ctxFor(h.db, org, "agenteA");
    const r = await competition(h.db, b, { year: Number(today.slice(0, 4)) });
    const top = r.agents[0];
    expect(top?.userId).toBe(a.userId);
    // 1 visita + 10 captación + 5 reserva + 20 cierre + 2 (USD 2.000 cobrados) = 38
    expect(top?.points).toBe(38);
    expect(r.me?.userId).toBe(b.userId);
    expect(r.branches[0]?.points).toBe(38);
    const mine = await competition(h.db, a, { year: Number(today.slice(0, 4)) });
    expect(mine.myMovements.length).toBeGreaterThanOrEqual(4);
  });
});

describe("mapa de cierres", () => {
  it("muestra vendidas con ubicación y cuenta las que no tienen", async () => {
    const b = await ctxFor(h.db, org, "agenteB");
    const r = await closingMap(h.db, b, { today });
    expect(r.counts.sold).toBe(1);
    expect(r.points[0]?.kind).toBe("sold");
    expect(r.points[0]?.lat).toBeCloseTo(-34.9115);
    expect(r.withoutLocation).toBe(0);
  });
});
