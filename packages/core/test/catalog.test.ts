import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inquiry, locality, neighborhood, propertyMedia, type DbHandle } from "@crm/db";
import { seedGeoUruguay } from "@crm/db/seed";
import {
  changePropertyStatus,
  createContact,
  createProperty,
  getCatalogProperty,
  listCatalog,
  listPortalAccounts,
  publishProperty,
  setPrices,
  setPropertyOwners,
  submitCatalogInquiry,
} from "../src";
import { createTestOrg, ctxFor, freshDb, type TestOrg } from "./fixtures";

let h: DbHandle;
let org: TestOrg;
let geo: { localityId: number; neighborhoodId: number; name: string };

beforeAll(async () => {
  h = await freshDb();
  await seedGeoUruguay(h.db);
  const [n] = await h.db
    .select({ localityId: locality.id, neighborhoodId: neighborhood.id, name: neighborhood.name })
    .from(neighborhood)
    .innerJoin(locality, eq(locality.id, neighborhood.localityId))
    .limit(1);
  if (!n) throw new Error("geo");
  geo = n;
  org = await createTestOrg(h.db, "catalog", { admin: { roleKey: "admin" } });
});
afterAll(async () => {
  await h.pool.end();
});

async function publish(input: { type: "apartment" | "house"; op: "sale" | "rent"; price: string; beds: number }) {
  const a = await ctxFor(h.db, org, "admin");
  await listPortalAccounts(h.db, a); // crea las cuentas (sitio web activo por defecto)
  const p = await createProperty(h.db, a, {
    type: input.type,
    operations: [input.op],
    title: `Propiedad ${input.type} ${input.price}`,
    description: "Propiedad luminosa con excelente ubicación, cerca de la rambla y de todos los servicios.",
    localityId: geo.localityId,
    neighborhoodId: geo.neighborhoodId,
    address: "Calle Secreta 1234",
    padron: "999999",
    bedrooms: input.beds,
    latitude: "-34.912345",
    longitude: "-56.154321",
  });
  await setPrices(h.db, a, {
    propertyId: p.id,
    prices: [{ operation: input.op, currency: input.op === "sale" ? "USD" : "UYU", list: input.price }],
  });
  const owner = (await createContact(h.db, a, { firstName: "Due", lastName: "Ño" })).contact;
  await setPropertyOwners(h.db, a, { propertyId: p.id, owners: [{ contactId: owner.id, sharePercent: "100" }] });
  for (let i = 0; i < 3; i++)
    await h.db.insert(propertyMedia).values({
      organizationId: org.organizationId,
      propertyId: p.id,
      kind: "photo",
      storageKey: `test/${p.id}/${i}.webp`,
      mimeType: "image/webp",
      sizeBytes: 1000,
      position: i,
      isCover: i === 0,
    });
  await changePropertyStatus(h.db, a, { propertyId: p.id, status: "available" });
  await publishProperty(h.db, a, { propertyId: p.id, portal: "website" });
  return p;
}

describe("catálogo público", () => {
  it("lista lo publicado en el sitio, filtra y no expone datos internos", async () => {
    const sale = await publish({ type: "apartment", op: "sale", price: "180000", beds: 2 });
    await publish({ type: "house", op: "sale", price: "450000", beds: 4 });
    await publish({ type: "apartment", op: "rent", price: "30000", beds: 1 });

    const all = await listCatalog(h.db, org.organizationId, {});
    expect(all.total).toBe(3);
    expect(all.options.zones).toContain(geo.name);

    const ventas = await listCatalog(h.db, org.organizationId, { operacion: "venta", orden: "precio-asc" });
    expect(ventas.items.map((i) => i.prices[0]?.amount)).toEqual([180000, 450000]);
    expect((await listCatalog(h.db, org.organizationId, { tipo: "house" })).items).toHaveLength(1);
    expect((await listCatalog(h.db, org.organizationId, { dormitorios: "3" })).items).toHaveLength(1);
    expect(
      (await listCatalog(h.db, org.organizationId, { operacion: "venta", precioMax: "200000" })).items,
    ).toHaveLength(1);
    // filtros inválidos se ignoran en vez de romper la página
    expect((await listCatalog(h.db, org.organizationId, { operacion: "x", dormitorios: "abc" })).items).toHaveLength(3);

    const detail = await getCatalogProperty(h.db, org.organizationId, sale.code);
    expect(detail?.item.photoIds).toHaveLength(3);
    expect(detail?.item.approxLocation?.lat).toBe(-34.912);
    const json = JSON.stringify(detail);
    expect(json).not.toContain("Calle Secreta");
    expect(json).not.toContain("999999");
    expect(await getCatalogProperty(h.db, org.organizationId, "PROP-999999")).toBeNull();
    expect(await getCatalogProperty(h.db, org.organizationId, "'; drop")).toBeNull();
  });

  it("la consulta del sitio llega a la bandeja; el campo trampa la descarta", async () => {
    const before = await h.db.select().from(inquiry).where(eq(inquiry.organizationId, org.organizationId));
    const r = await submitCatalogInquiry(h.db, org.organizationId, {
      name: "Ana Pérez",
      phone: "099123456",
      propertyCode: "PROP-000001",
    });
    expect(r.spam).toBe(false);
    const spam = await submitCatalogInquiry(h.db, org.organizationId, {
      name: "Bot",
      phone: "1",
      website: "http://spam",
    });
    expect(spam.spam).toBe(true);
    const after = await h.db.select().from(inquiry).where(eq(inquiry.organizationId, org.organizationId));
    expect(after.length).toBe(before.length + 1);
    expect(after.find((x) => x.name === "Ana Pérez")?.channel).toBe("web");
  });
});
