import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deal, dealCommission, dealOffer, locality, neighborhood, property, type DbHandle } from "@crm/db";
import { seedGeoUruguay } from "@crm/db/seed";
import {
  cancelReservation,
  changeDealStage,
  changePropertyStatus,
  ConflictError,
  createDeal,
  createLead,
  createOffer,
  createProperty,
  createReservation,
  dealOffers,
  expiringReservations,
  extendReservation,
  ForbiddenError,
  listOffers,
  listReservations,
  NotFoundError,
  pendingOffersCount,
  respondOffer,
  setPrices,
  ValidationError,
} from "../src";
import { createTestOrg, ctxFor, freshDb, type TestOrg } from "./fixtures";

let h: DbHandle;
let org: TestOrg;
let geo: { localityId: number; neighborhoodId: number };
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Montevideo" }).format(new Date());
const plusDays = (n: number) => {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

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
  org = await createTestOrg(h.db, "offers", {
    admin: { roleKey: "admin" },
    agenteA: { roleKey: "agent", inTeam: true },
    agenteB: { roleKey: "agent", branch: "second" },
    contable: { roleKey: "accounting" },
  });
});
afterAll(async () => {
  await h.pool.end();
});

async function newDeal() {
  const a = await ctxFor(h.db, org, "agenteA");
  const p = await createProperty(h.db, a, {
    type: "apartment",
    operations: ["sale"],
    title: "Apto para ofertar",
    commissionPercent: "3",
    localityId: geo.localityId,
    neighborhoodId: geo.neighborhoodId,
  });
  await setPrices(h.db, a, {
    propertyId: p.id,
    prices: [{ operation: "sale", currency: "USD", list: "200000" }],
  });
  await changePropertyStatus(h.db, a, { propertyId: p.id, status: "available" });
  const { lead } = await createLead(h.db, a, {
    operation: "buy",
    source: "portal",
    contact: { firstName: "Oferente", lastName: Math.random().toString(36).slice(2, 7) },
  });
  const d = await createDeal(h.db, a, {
    propertyId: p.id,
    operation: "sale",
    clientContactId: lead.contactId,
    leadId: lead.id,
    price: "200000",
  });
  return { a, d, propertyId: p.id };
}

describe("ofertas", () => {
  it("oferta → contraoferta → aceptación actualiza el precio de la operación", async () => {
    const { a, d } = await newDeal();
    const o1 = await createOffer(h.db, a, {
      dealId: d.id,
      currency: "USD",
      amount: "180.000",
      conditions: "Contado",
      validUntil: plusDays(3),
    });
    expect(o1.party).toBe("client");
    expect(
      await catchErr(createOffer(h.db, a, { dealId: d.id, currency: "USD", amount: "185000" })),
    ).toBeInstanceOf(ConflictError);
    const r = await respondOffer(h.db, a, {
      offerId: o1.id,
      response: "counter",
      amount: "192.000",
      currency: "USD",
      note: "El propietario baja un poco",
    });
    expect(r.offer?.status).toBe("countered");
    expect(r.counter).toMatchObject({ party: "owner", amountMinor: 19_200_000n, previousOfferId: o1.id });
    await respondOffer(h.db, a, { offerId: r.counter?.id, response: "accept" });
    const [row] = await h.db.select().from(deal).where(eq(deal.id, d.id));
    expect(row?.priceMinor).toBe(19_200_000n);
    const fees = await h.db.select().from(dealCommission).where(eq(dealCommission.dealId, d.id));
    expect(fees[0]?.amountMinor).toBe(576_000n); // 3 % de 192.000
    const hist = await dealOffers(h.db, a, d.id);
    expect(hist.offers.map((o) => o.status)).toEqual(["accepted", "countered"]);
    expect(await catchErr(respondOffer(h.db, a, { offerId: o1.id, response: "accept" }))).toBeInstanceOf(
      ConflictError,
    );
  });

  it("la base impide reescribir montos; otro agente no ve ni responde", async () => {
    const { a, d } = await newDeal();
    const o = await createOffer(h.db, a, { dealId: d.id, currency: "USD", amount: "150000" });
    await expect(
      h.db.update(dealOffer).set({ amountMinor: 1n }).where(eq(dealOffer.id, o.id)),
    ).rejects.toThrow();
    await expect(h.db.execute(sql`delete from deal_offer where id = ${o.id}`)).rejects.toThrow();
    const b = await ctxFor(h.db, org, "agenteB");
    expect(await catchErr(respondOffer(h.db, b, { offerId: o.id, response: "reject" }))).toBeInstanceOf(
      NotFoundError,
    );
    expect(await catchErr(dealOffers(h.db, b, d.id))).toBeInstanceOf(NotFoundError);
    expect((await listOffers(h.db, b, { status: "pending" })).some((x) => x.id === o.id)).toBe(false);
    expect((await listOffers(h.db, a, { status: "pending" })).some((x) => x.id === o.id)).toBe(true);
    expect((await pendingOffersCount(h.db, a, today))?.pending).toBeGreaterThanOrEqual(1);
    expect(
      await catchErr(respondOffer(h.db, a, { offerId: o.id, response: "counter", amount: "" })),
    ).toBeInstanceOf(ValidationError);
  });
});

describe("reservas", () => {
  it("reservar pasa la operación y la propiedad a reservada; avanzar convierte la seña", async () => {
    const { a, d, propertyId } = await newDeal();
    const o = await createOffer(h.db, a, { dealId: d.id, currency: "USD", amount: "195000" });
    expect(
      await catchErr(
        createReservation(h.db, a, {
          dealId: d.id,
          currency: "USD",
          deposit: "5000",
          receivedAt: today,
          expiresAt: plusDays(15),
        }),
      ),
    ).toBeInstanceOf(ConflictError); // oferta sin responder
    await respondOffer(h.db, a, { offerId: o.id, response: "accept" });
    const r = await createReservation(h.db, a, {
      dealId: d.id,
      currency: "USD",
      deposit: "5.000",
      receivedAt: today,
      expiresAt: plusDays(5),
      holder: "agency",
      receiptNumber: "R-001",
    });
    const [dr] = await h.db.select().from(deal).where(eq(deal.id, d.id));
    const [pr] = await h.db.select().from(property).where(eq(property.id, propertyId));
    expect(dr?.stage).toBe("reserved");
    expect(pr?.status).toBe("reserved");
    // Con seña vigente no se puede caer "a mano".
    expect(
      await catchErr(changeDealStage(h.db, a, { id: d.id, stage: "fallen", fallenReason: "x" })),
    ).toBeInstanceOf(ConflictError);
    const list = await listReservations(h.db, a, { status: "active", today });
    expect(list.held.agency?.USD).toBeGreaterThanOrEqual(500_000n);
    expect(list.expiringCount).toBeGreaterThanOrEqual(1);
    expect((await expiringReservations(h.db, a, today)).some((x) => x.id === r.id)).toBe(true);
    await extendReservation(h.db, a, {
      reservationId: r.id,
      expiresAt: plusDays(30),
      note: "Demora del banco",
    });
    expect((await expiringReservations(h.db, a, today)).some((x) => x.id === r.id)).toBe(false);

    await changeDealStage(h.db, a, { id: d.id, stage: "notary" });
    const after = await dealOffers(h.db, a, d.id);
    expect(after.reservations[0]?.status).toBe("converted");
  });

  it("cancelar con seña retenida hace caer la operación y libera la propiedad", async () => {
    const { a, d, propertyId } = await newDeal();
    const r = await createReservation(h.db, a, {
      dealId: d.id,
      currency: "USD",
      deposit: "3000",
      receivedAt: today,
      expiresAt: plusDays(10),
    });
    expect(
      await catchErr(
        cancelReservation(h.db, a, { reservationId: r.id, outcome: "refunded", reason: "Se arrepintió" }),
      ),
    ).toBeInstanceOf(ValidationError); // falta fecha de devolución
    await cancelReservation(h.db, a, {
      reservationId: r.id,
      outcome: "forfeited",
      reason: "No consiguió el crédito",
    });
    const [dr] = await h.db.select().from(deal).where(eq(deal.id, d.id));
    const [pr] = await h.db.select().from(property).where(eq(property.id, propertyId));
    expect(dr?.stage).toBe("fallen");
    expect(pr?.status).toBe("available");
  });

  it("cancelar con devolución puede volver a negociación; contable no gestiona reservas", async () => {
    const { a, d } = await newDeal();
    const r = await createReservation(h.db, a, {
      dealId: d.id,
      currency: "USD",
      deposit: "3000",
      receivedAt: today,
      expiresAt: plusDays(10),
    });
    const cont = await ctxFor(h.db, org, "contable");
    const err = await catchErr(
      cancelReservation(h.db, cont, {
        reservationId: r.id,
        outcome: "refunded",
        reason: "Prueba sin permiso",
        refundedAt: today,
      }),
    );
    expect(err instanceof ForbiddenError || err instanceof NotFoundError).toBe(true);
    await cancelReservation(h.db, a, {
      reservationId: r.id,
      outcome: "refunded",
      reason: "Cambió la fecha de mudanza",
      refundedAt: today,
      backToNegotiation: true,
    });
    const [dr] = await h.db.select().from(deal).where(eq(deal.id, d.id));
    expect(dr?.stage).toBe("negotiation");
    // Se puede volver a ofertar.
    await createOffer(h.db, a, { dealId: d.id, currency: "USD", amount: "190000" });
  });
});
