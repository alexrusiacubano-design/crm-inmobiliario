import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  commissionSettings,
  locality,
  neighborhood,
  property,
  propertyMedia,
  propertyPublication,
  type DbHandle,
} from "@crm/db";
import { seedGeoUruguay } from "@crm/db/seed";
import {
  changeDealStage,
  changePropertyStatus,
  changePublicationStatus,
  ConflictError,
  createContact,
  createDeal,
  createLead,
  createProperty,
  feedListings,
  feedPhotoAllowed,
  ForbiddenError,
  listExchangeRates,
  listPortalAccounts,
  listPublications,
  publishProperty,
  rotateFeedToken,
  saveExchangeRate,
  savePortalAccount,
  setPrices,
  setPropertyOwners,
  updatePublication,
} from "../src";
import { createTestOrg, ctxFor, freshDb, type TestOrg } from "./fixtures";

let h: DbHandle;
let org: TestOrg;
let geo: { localityId: number; neighborhoodId: number };
const today = "2026-10-03";

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
  org = await createTestOrg(h.db, "pubs", {
    admin: { roleKey: "admin" },
    agenteA: { roleKey: "agent", inTeam: true },
  });
});
afterAll(async () => {
  await h.pool.end();
});

async function readyProperty(complete = true) {
  const a = await ctxFor(h.db, org, "agenteA");
  const p = await createProperty(h.db, a, {
    type: "apartment",
    operations: ["sale"],
    title: "Apartamento luminoso con balcón",
    description: complete
      ? "Apartamento de dos dormitorios, muy luminoso, con balcón al frente y cocina integrada."
      : "Corto",
    localityId: geo.localityId,
    neighborhoodId: geo.neighborhoodId,
    padron: "123456",
  });
  await setPrices(h.db, a, {
    propertyId: p.id,
    prices: [{ operation: "sale", currency: "USD", list: "180000" }],
  });
  const owner = (await createContact(h.db, a, { firstName: "Due", lastName: "Ño" })).contact;
  await setPropertyOwners(h.db, a, {
    propertyId: p.id,
    owners: [{ contactId: owner.id, sharePercent: "100" }],
  });
  for (let i = 0; i < 3; i++)
    await h.db.insert(propertyMedia).values({
      organizationId: org.organizationId,
      propertyId: p.id,
      kind: "photo",
      storageKey: `test/${p.id}/${i}.jpg`,
      thumbKey: `test/${p.id}/${i}-t.jpg`,
      mimeType: "image/jpeg",
      sizeBytes: 1000,
      position: i,
      isCover: i === 0,
    });
  await changePropertyStatus(h.db, a, { propertyId: p.id, status: "available" });
  return { a, p };
}

describe("publicaciones", () => {
  it("publica con checklist y portal activo, respeta cupos y pasa la propiedad a publicada", async () => {
    const admin = await ctxFor(h.db, org, "admin");
    const accounts = await listPortalAccounts(h.db, admin);
    expect(accounts.length).toBe(5);
    const { a: agent, p } = await readyProperty();
    expect(
      await catchErr(publishProperty(h.db, agent, { propertyId: p.id, portal: "infocasas" })),
    ).toBeInstanceOf(ForbiddenError); // los agentes no publican: gerencia o administración
    const a = admin;
    expect(
      await catchErr(publishProperty(h.db, a, { propertyId: p.id, portal: "infocasas" })),
    ).toBeInstanceOf(ConflictError); // portal inactivo
    await savePortalAccount(h.db, admin, {
      portal: "infocasas",
      enabled: true,
      accountRef: "inmo-123",
      quotas: { gold: 1 },
    });
    const pub = await publishProperty(h.db, a, {
      propertyId: p.id,
      portal: "infocasas",
      level: "gold",
      url: "https://www.infocasas.com.uy/aviso/1",
      expiresAt: "2026-10-08",
    });
    expect(pub?.status).toBe("published");
    const [pr] = await h.db.select().from(property).where(eq(property.id, p.id));
    expect(pr?.status).toBe("published");
    expect(pr?.padron).toBe("123456");
    const { p: p2 } = await readyProperty();
    expect(
      await catchErr(publishProperty(h.db, a, { propertyId: p2.id, portal: "infocasas", level: "gold" })),
    ).toBeInstanceOf(ConflictError); // sin cupo oro
    await publishProperty(h.db, a, { propertyId: p2.id, portal: "infocasas", level: "silver" });
    const list = await listPublications(h.db, a, { status: "alerts", today });
    expect(list.items.find((i) => i.id === pub?.id)?.alerts).toEqual(["expiring"]);
    expect(list.portals.find((x) => x.portal === "infocasas")?.used).toEqual({ gold: 1, silver: 1 });

    await updatePublication(h.db, a, {
      id: pub?.id,
      level: "gold",
      views: 120,
      contacts: 4,
      url: pub?.url,
      expiresAt: "2026-11-08",
    });
    await changePublicationStatus(h.db, a, { id: pub?.id, status: "paused" });
    await changePublicationStatus(h.db, a, { id: pub?.id, status: "published" });
  });

  it("checklist incompleto no publica; vender baja los avisos; feed por token", async () => {
    const admin = await ctxFor(h.db, org, "admin");
    const { p: bad } = await readyProperty(false);
    const a = admin;
    await savePortalAccount(h.db, admin, { portal: "gallito", enabled: true, quotas: {} });
    const err = await catchErr(publishProperty(h.db, a, { propertyId: bad.id, portal: "gallito" }));
    expect(err).toBeInstanceOf(ConflictError);
    expect(String((err as Error).message)).toContain("Descripción");

    const { p } = await readyProperty();
    const pub = await publishProperty(h.db, a, { propertyId: p.id, portal: "gallito" });
    const account = (await listPortalAccounts(h.db, admin)).find((x) => x.portal === "gallito");
    const feed = await feedListings(h.db, account?.feedToken ?? "");
    expect(feed?.listings.some((l) => l.p.id === p.id)).toBe(true);
    const photoId = feed?.listings.find((l) => l.p.id === p.id)?.photoIds[0] ?? "";
    expect(await feedPhotoAllowed(h.db, account?.feedToken ?? "", photoId)).toBe(true);
    expect(await feedListings(h.db, "f".repeat(48))).toBeNull();
    const rotated = await rotateFeedToken(h.db, admin, "gallito");
    expect(await feedListings(h.db, account?.feedToken ?? "")).toBeNull();
    expect(await feedListings(h.db, rotated.feedToken)).not.toBeNull();

    const ag = await ctxFor(h.db, org, "agenteA");
    const { lead } = await createLead(h.db, ag, {
      operation: "buy",
      source: "portal",
      contact: { firstName: "Com", lastName: "Prador" },
    });
    const d = await createDeal(h.db, ag, {
      propertyId: p.id,
      operation: "sale",
      clientContactId: lead.contactId,
      leadId: lead.id,
      price: "175000",
    });
    await changeDealStage(h.db, ag, { id: d.id, stage: "reserved" });
    const [paused] = await h.db
      .select()
      .from(propertyPublication)
      .where(eq(propertyPublication.id, pub?.id ?? ""));
    expect(paused?.status).toBe("paused"); // reservada → pausada
    await changeDealStage(h.db, admin, { id: d.id, stage: "closed" });
    const [removed] = await h.db
      .select()
      .from(propertyPublication)
      .where(eq(propertyPublication.id, pub?.id ?? ""));
    expect(removed?.status).toBe("removed"); // vendida → baja
  });
});

describe("tipo de cambio", () => {
  it("el más reciente pasa a ser el de referencia; solo administración", async () => {
    const admin = await ctxFor(h.db, org, "admin");
    await saveExchangeRate(h.db, admin, { date: "2026-10-01", rate: "39,90" });
    await saveExchangeRate(h.db, admin, { date: "2026-10-02", rate: "40.05" }, "bcu");
    await saveExchangeRate(h.db, admin, { date: "2026-09-15", rate: "38" }); // viejo: no pisa
    const [s] = await h.db
      .select()
      .from(commissionSettings)
      .where(eq(commissionSettings.organizationId, org.organizationId));
    expect(s?.uyuPerUsd).toBe("40.0500");
    const r = await listExchangeRates(h.db, admin);
    expect(r.items[0]).toMatchObject({ date: "2026-10-02", source: "bcu" });
    const a = await ctxFor(h.db, org, "agenteA");
    expect(await catchErr(saveExchangeRate(h.db, a, { date: "2026-10-03", rate: "40" }))).toBeInstanceOf(
      ForbiddenError,
    );
  });
});
