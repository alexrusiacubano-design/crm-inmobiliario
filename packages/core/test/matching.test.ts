import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activity, locality, neighborhood, type DbHandle } from "@crm/db";
import { seedGeoUruguay } from "@crm/db/seed";
import {
  changePropertyStatus,
  createLead,
  createProperty,
  ForbiddenError,
  leadMatches,
  matchingOverview,
  myNewMatches,
  NotFoundError,
  propertyMatches,
  saveSearchProfile,
  setMatchStatus,
  setPrices,
  suggestComparables,
} from "../src";
import { createTestOrg, ctxFor, freshDb, type TestOrg } from "./fixtures";

let h: DbHandle;
let org: TestOrg;
let geo: { localityId: number; neighborhoodId: number };
let other: { localityId: number; neighborhoodId: number };
let leadA = "";
let propGood = "";
let propPricey = "";
let propOtherZone = "";

async function catchErr(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => null,
    (e: unknown) => e,
  );
}

beforeAll(async () => {
  h = await freshDb();
  await seedGeoUruguay(h.db);
  const rows = await h.db
    .select({ localityId: locality.id, neighborhoodId: neighborhood.id })
    .from(neighborhood)
    .innerJoin(locality, eq(locality.id, neighborhood.localityId))
    .limit(2);
  geo = rows[0] as typeof geo;
  other = rows[1] as typeof other;
  org = await createTestOrg(h.db, "match", {
    admin: { roleKey: "admin" },
    agenteA: { roleKey: "agent", inTeam: true },
    agenteB: { roleKey: "agent", branch: "second" },
    contable: { roleKey: "accounting" },
  });
  const a = await ctxFor(h.db, org, "agenteA");
  const mk = async (title: string, price: string, zone: typeof geo, area: string, bedrooms: number) => {
    const p = await createProperty(h.db, a, {
      type: "apartment",
      operations: ["sale"],
      title,
      localityId: zone.localityId,
      neighborhoodId: zone.neighborhoodId,
      bedrooms,
      builtArea: area,
    });
    await setPrices(h.db, a, {
      propertyId: p.id,
      prices: [{ operation: "sale", currency: "USD", list: price }],
    });
    await changePropertyStatus(h.db, a, { propertyId: p.id, status: "available" });
    return p.id;
  };
  propGood = await mk("Apto ideal", "180.000", geo, "70", 2);
  propPricey = await mk("Apto un poco caro", "215.000", geo, "80", 2);
  propOtherZone = await mk("Apto en otro barrio", "150.000", other, "70", 2);
  await mk("Apto carísimo", "400.000", geo, "140", 3);

  const { lead } = await createLead(h.db, a, {
    operation: "buy",
    source: "portal",
    contact: { firstName: "Busca", lastName: "Apto" },
  });
  leadA = lead.id;
  await saveSearchProfile(h.db, a, {
    leadId: leadA,
    search: {
      operation: "buy",
      propertyTypes: ["apartment"],
      neighborhoodIds: [geo.neighborhoodId],
      currency: "USD",
      priceMax: "200.000",
      bedroomsMin: "2",
    },
  });
});
afterAll(async () => {
  await h.pool.end();
});

describe("matching lead → propiedades", () => {
  it("sugiere las que cumplen, con la más ajustada primero", async () => {
    const a = await ctxFor(h.db, org, "agenteA");
    const r = await leadMatches(h.db, a, leadA);
    expect(r.hasProfile).toBe(true);
    expect(r.canManage).toBe(true);
    expect(r.items.map((i) => i.propertyId)).toEqual([propGood, propPricey]);
    expect(r.items[0]?.score).toBe(100);
    expect(r.items[1]?.score).toBe(85);
    expect(r.items.some((i) => i.propertyId === propOtherZone)).toBe(false);
  });

  it("al cambiar la búsqueda, las sugerencias sin trabajar se recalculan", async () => {
    const a = await ctxFor(h.db, org, "agenteA");
    const first = await leadMatches(h.db, a, leadA);
    const good = first.items.find((i) => i.propertyId === propGood);
    await setMatchStatus(h.db, a, { matchId: good?.id, status: "sent", note: "Por WhatsApp" });
    await saveSearchProfile(h.db, a, {
      leadId: leadA,
      search: {
        operation: "buy",
        propertyTypes: ["apartment"],
        neighborhoodIds: [other.neighborhoodId],
        currency: "USD",
        priceMax: "200.000",
      },
    });
    const r = await leadMatches(h.db, a, leadA);
    const ids = r.items.map((i) => i.propertyId);
    expect(ids).toContain(propOtherZone);
    expect(ids).not.toContain(propPricey); // estaba sugerida y ya no cumple: se borra
    const kept = r.items.find((i) => i.propertyId === propGood);
    expect(kept).toMatchObject({ status: "sent", active: false }); // ya enviada: queda en el historial
    const timeline = await h.db.select().from(activity).where(eq(activity.leadId, leadA));
    expect(timeline.some((t) => t.type === "property_sent")).toBe(true);
  });

  it("marcar interés queda en el timeline; otro agente no puede", async () => {
    const a = await ctxFor(h.db, org, "agenteA");
    const b = await ctxFor(h.db, org, "agenteB");
    const r = await leadMatches(h.db, a, leadA);
    const m = r.items.find((i) => i.propertyId === propOtherZone);
    expect(await catchErr(leadMatches(h.db, b, leadA))).toBeInstanceOf(NotFoundError);
    expect(await catchErr(setMatchStatus(h.db, b, { matchId: m?.id, status: "discarded" }))).toBeInstanceOf(
      NotFoundError,
    );
    await setMatchStatus(h.db, a, { matchId: m?.id, status: "interested", note: "Quiere visitarla" });
    const timeline = await h.db.select().from(activity).where(eq(activity.leadId, leadA));
    expect(timeline.some((t) => t.type === "match_feedback")).toBe(true);
    const cont = await ctxFor(h.db, org, "contable");
    expect(await catchErr(setMatchStatus(h.db, cont, { matchId: m?.id, status: "sent" }))).toBeInstanceOf(
      NotFoundError,
    );
  });

  it("si la propiedad se reserva, la sugerencia trabajada queda inactiva", async () => {
    const a = await ctxFor(h.db, org, "agenteA");
    await changePropertyStatus(h.db, a, { propertyId: propOtherZone, status: "reserved" });
    const r = await leadMatches(h.db, a, leadA);
    expect(r.items.find((i) => i.propertyId === propOtherZone)).toMatchObject({
      status: "interested",
      active: false,
    });
    await changePropertyStatus(h.db, a, { propertyId: propOtherZone, status: "available" });
  });
});

describe("matching propiedad → clientes y tablero", () => {
  it("la ficha de propiedad lista los interesados que ve el usuario", async () => {
    const a = await ctxFor(h.db, org, "agenteA");
    const b = await ctxFor(h.db, org, "agenteB");
    const r = await propertyMatches(h.db, a, propOtherZone);
    expect(r.items.map((i) => i.leadId)).toEqual([leadA]);
    const rb = await propertyMatches(h.db, b, propOtherZone);
    expect(rb.items).toHaveLength(0); // el lead es de otro agente
  });

  it("tablero y resumen del dashboard", async () => {
    const a = await ctxFor(h.db, org, "agenteA");
    const o = await matchingOverview(h.db, a);
    expect(o.totals.leads).toBe(1);
    expect(o.items[0]).toMatchObject({ leadId: leadA, interested: 1 });
    const mine = await myNewMatches(h.db, a);
    expect(mine?.total).toBe(o.items[0]?.suggested);
    const cont = await ctxFor(h.db, org, "contable");
    expect(await catchErr(matchingOverview(h.db, cont))).toBeInstanceOf(ForbiddenError);
  });
});

describe("comparables", () => {
  it("usa el mismo barrio y tipo, y sugiere valor por mediana de m²", async () => {
    const a = await ctxFor(h.db, org, "agenteA");
    const r = await suggestComparables(h.db, a, { propertyId: propGood });
    // Mismo tipo y ±35 % de 70 m²: el de 80 m² entra, el de 140 m² no. Con menos de 3 en el
    // barrio amplía a la localidad.
    expect(r.zone).toBe(geo.localityId === other.localityId ? "locality" : "neighborhood");
    const ids = r.items.map((i) => i.propertyId);
    expect(ids).toContain(propPricey);
    expect(ids).not.toContain(propGood);
    expect(r.items.every((i) => (i.areaM2 ?? 0) <= 94)).toBe(true);
    const ppm = r.items.map((i) => i.pricePerM2Minor ?? 0n).sort((x, y) => (x < y ? -1 : 1));
    expect(r.medianPricePerM2Minor).toBe(
      ppm.length % 2
        ? ppm[(ppm.length - 1) / 2]
        : ((ppm[ppm.length / 2 - 1] ?? 0n) + (ppm[ppm.length / 2] ?? 0n)) / 2n,
    );
    expect(r.suggestedValueMinor).toBe((r.medianPricePerM2Minor ?? 0n) * 70n);
    expect(r.confidence).toBe("low");
    const loose = await suggestComparables(h.db, a, {
      type: "apartment",
      localityId: geo.localityId,
      areaM2: 75,
    });
    expect(loose.items.length).toBeGreaterThanOrEqual(2);
  });
});
