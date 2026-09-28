import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  acquisition,
  auditLog,
  domainEvent,
  locality,
  neighborhood,
  ownerProfile,
  property,
  propertyMedia,
  propertyPriceHistory,
  type DbHandle,
} from "@crm/db";
import { seedGeoUruguay } from "@crm/db/seed";
import {
  addPropertyImage,
  addPropertyVideo,
  changeAcquisitionStage,
  changePropertyStatus,
  ConflictError,
  createAcquisition,
  createContact,
  createProperty,
  createValuation,
  deleteDocument,
  deletePropertyMedia,
  ForbiddenError,
  getProperty,
  globalSearch,
  listAcquisitions,
  listDocuments,
  listEntityDocuments,
  listPriceHistory,
  listProperties,
  LocalDiskStorage,
  NotFoundError,
  readDocumentFile,
  readPropertyMedia,
  reorderPropertyMedia,
  setPrices,
  setPropertyCover,
  setPropertyOwners,
  updateProperty,
  uploadDocument,
  ValidationError,
} from "../src";
import { createTestOrg, ctxFor, freshDb, type TestOrg } from "./fixtures";

let h: DbHandle;
let org: TestOrg;
let storageDir: string;
let storage: LocalDiskStorage;
let geo: { localityId: number; neighborhoodId: number };

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
  storageDir = await mkdtemp(join(tmpdir(), "crm-storage-"));
  storage = new LocalDiskStorage(storageDir);
  org = await createTestOrg(h.db, "props", {
    admin: { roleKey: "admin" },
    supervisor: { roleKey: "supervisor", inTeam: true },
    agenteA: { roleKey: "agent", inTeam: true },
    agenteB: { roleKey: "agent", branch: "second" },
    contable: { roleKey: "accounting" },
  });
});
afterAll(async () => {
  await h.pool.end();
  await rm(storageDir, { recursive: true, force: true });
});

async function jpeg(color: { r: number; g: number; b: number }, width = 1200, height = 800): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: color } })
    .jpeg()
    .withMetadata({ exif: { IFD0: { Copyright: "secreto" } } })
    .toBuffer();
}

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

async function newOwner(key = "agenteA", name = "Dueña") {
  const ctx = await ctxFor(h.db, org, key);
  const { contact } = await createContact(h.db, ctx, {
    firstName: name,
    lastName: `Test ${Math.random().toString(36).slice(2, 7)}`,
  });
  return contact;
}

async function newProperty(key = "agenteA", extra: Record<string, unknown> = {}) {
  const ctx = await ctxFor(h.db, org, key);
  return createProperty(h.db, ctx, {
    type: "apartment",
    operations: ["sale"],
    title: "Apartamento luminoso en Pocitos",
    description: "Dos dormitorios, living comedor al frente con balcón, a dos cuadras de la rambla.",
    localityId: geo.localityId,
    neighborhoodId: geo.neighborhoodId,
    bedrooms: 2,
    bathrooms: 1,
    totalArea: "72,5",
    commissionPercent: "3",
    ...extra,
  });
}

async function catchErr(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => null,
    (e: unknown) => e,
  );
}

describe("propiedades", () => {
  it("crea con código PROP, responsable, sucursal e índice de búsqueda", async () => {
    const ctx = await ctxFor(h.db, org, "agenteA");
    const p = await newProperty();
    expect(p.code).toMatch(/^PROP-\d{6}$/);
    expect(p.status).toBe("draft");
    expect(p.assignedUserId).toBe(ctx.userId);
    expect(p.captadorUserId).toBe(ctx.userId);
    expect(p.branchId).toBe(org.branchIds.main);
    expect(p.commissionBasisPoints).toBe(300);
    expect(p.totalArea).toBe("72.50");
    const hits = await globalSearch(h.db, ctx, { q: p.code });
    expect(hits.some((x) => x.entityType === "property" && x.id === p.id)).toBe(true);
    const hits2 = await globalSearch(h.db, ctx, { q: "pocitos luminoso" });
    expect(hits2.some((x) => x.id === p.id)).toBe(true);
  });

  it("valida barrio contra localidad", async () => {
    const [other] = await h.db
      .select({ id: locality.id })
      .from(locality)
      .where(sql`${locality.id} <> ${geo.localityId}`)
      .limit(1);
    const err = await catchErr(newProperty("agenteA", { localityId: other?.id }));
    expect(err).toBeInstanceOf(ValidationError);
  });

  it("un agente no puede asignar propiedades a otro", async () => {
    const err = await catchErr(newProperty("agenteA", { assignedUserId: org.members.agenteB?.userId }));
    expect(err).toBeInstanceOf(ForbiddenError);
  });

  it("todos los agentes ven el inventario, pero solo el responsable edita", async () => {
    const p = await newProperty();
    const ctxB = await ctxFor(h.db, org, "agenteB");
    const detail = await getProperty(h.db, ctxB, p.id);
    expect(detail.permissions.update).toBe(false);
    const list = await listProperties(h.db, ctxB, { q: p.code });
    expect(list.items.map((i) => i.id)).toContain(p.id);
    const err = await catchErr(
      updateProperty(h.db, ctxB, {
        id: p.id,
        type: "apartment",
        operations: ["sale"],
        title: "Cambiado por otro",
      }),
    );
    expect(err).toBeInstanceOf(ForbiddenError);
  });

  it("quitar una operación elimina su precio dejando rastro en el historial", async () => {
    const ctx = await ctxFor(h.db, org, "agenteA");
    const p = await newProperty("agenteA", { operations: ["sale", "rent"] });
    await setPrices(h.db, ctx, {
      propertyId: p.id,
      prices: [
        { operation: "sale", currency: "USD", list: "180.000" },
        { operation: "rent", currency: "UYU", list: "32.000" },
      ],
    });
    await updateProperty(h.db, ctx, {
      id: p.id,
      type: "apartment",
      operations: ["sale"],
      title: p.title,
      description: p.description,
      localityId: geo.localityId,
    });
    const detail = await getProperty(h.db, ctx, p.id);
    expect(detail.prices.map((x) => x.operation)).toEqual(["sale"]);
    const history = await listPriceHistory(h.db, ctx, p.id);
    expect(
      history.some((x) => x.operation === "rent" && x.newMinor === null && x.oldMinor === 3_200_000n),
    ).toBe(true);
  });
});

describe("precios", () => {
  it("historial append-only, mínimo oculto sin permiso y evento de rebaja", async () => {
    const agent = await ctxFor(h.db, org, "agenteA");
    const sup = await ctxFor(h.db, org, "supervisor");
    const p = await newProperty();
    await setPrices(h.db, agent, {
      propertyId: p.id,
      prices: [
        { operation: "sale", currency: "USD", list: "230.000", ownerAsking: "240.000", minimum: "200.000" },
      ],
    });
    // El agente no tiene permiso de mínimo: se ignora lo que envíe.
    let d = await getProperty(h.db, sup, p.id);
    expect(d.prices[0]?.listMinor).toBe(23_000_000n);
    expect(d.prices[0]?.minimumMinor).toBeNull();

    await setPrices(h.db, sup, {
      propertyId: p.id,
      prices: [
        { operation: "sale", currency: "USD", list: "230.000", ownerAsking: "240.000", minimum: "210.000" },
      ],
    });
    d = await getProperty(h.db, agent, p.id);
    expect(d.prices[0]?.minimumMinor).toBeNull();
    expect(d.prices[0]?.minimumHidden).toBe(true);
    d = await getProperty(h.db, sup, p.id);
    expect(d.prices[0]?.minimumMinor).toBe(21_000_000n);

    // El agente edita el precio sin tocar el mínimo que fijó el supervisor.
    await setPrices(h.db, agent, {
      propertyId: p.id,
      prices: [{ operation: "sale", currency: "USD", list: "219.000", ownerAsking: "240.000", minimum: "1" }],
    });
    d = await getProperty(h.db, sup, p.id);
    expect(d.prices[0]?.listMinor).toBe(21_900_000n);
    expect(d.prices[0]?.minimumMinor).toBe(21_000_000n);

    const [ev] = await h.db
      .select()
      .from(domainEvent)
      .where(and(eq(domainEvent.aggregateId, p.id), eq(domainEvent.type, "property.price_reduced")));
    expect(ev).toBeDefined();

    const agentHistory = await listPriceHistory(h.db, agent, p.id);
    expect(agentHistory.some((x) => x.field === "minimum")).toBe(false);
    const supHistory = await listPriceHistory(h.db, sup, p.id);
    expect(supHistory.some((x) => x.field === "minimum")).toBe(true);

    const err = await catchErr(
      h.db.execute(sql`delete from property_price_history where property_id = ${p.id}`),
    );
    const e = err as { message?: string; cause?: { message?: string } } | null;
    expect(`${e?.message} ${e?.cause?.message ?? ""}`).toMatch(/append-only/);
    const rows = await h.db
      .select()
      .from(propertyPriceHistory)
      .where(eq(propertyPriceHistory.propertyId, p.id));
    expect(rows.length).toBeGreaterThanOrEqual(4);
  });

  it("rechaza precios para operaciones no habilitadas y mínimo mayor al publicado", async () => {
    const ctx = await ctxFor(h.db, org, "supervisor");
    const p = await newProperty("agenteA");
    expect(
      await catchErr(
        setPrices(h.db, ctx, {
          propertyId: p.id,
          prices: [{ operation: "rent", currency: "UYU", list: "30.000" }],
        }),
      ),
    ).toBeInstanceOf(ValidationError);
    expect(
      await catchErr(
        setPrices(h.db, ctx, {
          propertyId: p.id,
          prices: [{ operation: "sale", currency: "USD", list: "100.000", minimum: "150.000" }],
        }),
      ),
    ).toBeInstanceOf(ValidationError);
  });
});

describe("propietarios", () => {
  it("deben sumar 100 % y se registran como propietarios", async () => {
    const ctx = await ctxFor(h.db, org, "agenteA");
    const p = await newProperty();
    const a = await newOwner();
    const b = await newOwner();
    expect(
      await catchErr(
        setPropertyOwners(h.db, ctx, {
          propertyId: p.id,
          owners: [
            { contactId: a.id, sharePercent: "50" },
            { contactId: b.id, sharePercent: "40" },
          ],
        }),
      ),
    ).toBeInstanceOf(ValidationError);
    await setPropertyOwners(h.db, ctx, {
      propertyId: p.id,
      owners: [
        { contactId: a.id, sharePercent: "50" },
        { contactId: b.id, sharePercent: "50" },
      ],
    });
    const profiles = await h.db.select().from(ownerProfile).where(eq(ownerProfile.contactId, a.id));
    expect(profiles).toHaveLength(1);
    const d = await getProperty(h.db, ctx, p.id);
    expect(d.owners.map((o) => o.shareBasisPoints)).toEqual([5000, 5000]);
  });

  it("no se puede asociar un contacto que el agente no ve", async () => {
    const ctxA = await ctxFor(h.db, org, "agenteA");
    const p = await newProperty();
    const ajeno = await newOwner("agenteB");
    const err = await catchErr(
      setPropertyOwners(h.db, ctxA, {
        propertyId: p.id,
        owners: [{ contactId: ajeno.id, sharePercent: "100" }],
      }),
    );
    expect(err).toBeInstanceOf(ForbiddenError);
  });

  it("los datos del propietario se ocultan a quien no puede verlo", async () => {
    const ctxA = await ctxFor(h.db, org, "agenteA");
    const p = await newProperty();
    const o = await newOwner();
    await setPropertyOwners(h.db, ctxA, {
      propertyId: p.id,
      owners: [{ contactId: o.id, sharePercent: "100" }],
    });
    const d = await getProperty(h.db, await ctxFor(h.db, org, "agenteB"), p.id);
    expect(d.owners[0]?.contactId).toBeNull();
    expect(d.owners[0]?.displayName).toBe("Propietario (restringido)");
    expect(d.ownerIdsForEdit).toBeNull();
    // Aunque la propiedad sea suya, si no ve al propietario no recibe su identidad.
    const own = await newProperty("agenteB");
    const admin = await ctxFor(h.db, org, "admin");
    await setPropertyOwners(h.db, admin, {
      propertyId: own.id,
      owners: [{ contactId: o.id, sharePercent: "100" }],
    });
    const mine = await getProperty(h.db, await ctxFor(h.db, org, "agenteB"), own.id);
    expect(mine.permissions.update).toBe(true);
    expect(mine.ownerIdsForEdit).toBeNull();
    expect(
      JSON.stringify(mine, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v)),
    ).not.toContain(o.displayName);
  });
});

describe("multimedia", () => {
  it("procesa imágenes, quita EXIF, genera miniatura y maneja la portada", async () => {
    const ctx = await ctxFor(h.db, org, "agenteA");
    const p = await newProperty();
    const m1 = await addPropertyImage(
      h.db,
      ctx,
      storage,
      { propertyId: p.id },
      { bytes: await jpeg({ r: 200, g: 50, b: 50 }, 3000, 2000), fileName: "a.jpg" },
    );
    const m2 = await addPropertyImage(
      h.db,
      ctx,
      storage,
      { propertyId: p.id },
      { bytes: await jpeg({ r: 50, g: 200, b: 50 }), fileName: "b.jpg" },
    );
    const m3 = await addPropertyImage(
      h.db,
      ctx,
      storage,
      { propertyId: p.id },
      { bytes: await jpeg({ r: 50, g: 50, b: 200 }), fileName: "c.jpg" },
    );
    expect(m1.isCover).toBe(true);
    expect(m2.isCover).toBe(false);
    expect(m1.width).toBe(2000);
    expect(m1.mimeType).toBe("image/webp");

    const full = await readPropertyMedia(h.db, ctx, storage, m1.id, "full");
    const meta = await sharp(full.body).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.exif).toBeUndefined();
    const thumb = await readPropertyMedia(h.db, ctx, storage, m1.id, "thumb");
    expect((await sharp(thumb.body).metadata()).width).toBe(480);

    await setPropertyCover(h.db, ctx, m3.id);
    await reorderPropertyMedia(h.db, ctx, { propertyId: p.id, orderedIds: [m3.id, m1.id, m2.id] });
    let rows = await h.db
      .select()
      .from(propertyMedia)
      .where(eq(propertyMedia.propertyId, p.id))
      .orderBy(propertyMedia.position);
    expect(rows.map((r) => r.id)).toEqual([m3.id, m1.id, m2.id]);
    expect(rows.filter((r) => r.isCover).map((r) => r.id)).toEqual([m3.id]);

    await deletePropertyMedia(h.db, ctx, storage, m3.id);
    rows = await h.db
      .select()
      .from(propertyMedia)
      .where(eq(propertyMedia.propertyId, p.id))
      .orderBy(propertyMedia.position);
    expect(rows.map((r) => r.position)).toEqual([0, 1]);
    expect(rows[0]?.isCover).toBe(true);
    expect(await catchErr(storage.get(m3.storageKey ?? ""))).toBeInstanceOf(Error);
  });

  it("rechaza archivos que no son imágenes aunque digan serlo", async () => {
    const ctx = await ctxFor(h.db, org, "agenteA");
    const p = await newProperty();
    const err = await catchErr(
      addPropertyImage(
        h.db,
        ctx,
        storage,
        { propertyId: p.id },
        { bytes: Buffer.from("<html><script>x</script></html>"), fileName: "foto.jpg" },
      ),
    );
    expect(err).toBeInstanceOf(ValidationError);
    const pdf = await catchErr(
      addPropertyImage(h.db, ctx, storage, { propertyId: p.id }, { bytes: PDF, fileName: "foto.jpg" }),
    );
    expect(pdf).toBeInstanceOf(ValidationError);
  });

  it("otro agente no puede subir fotos a una propiedad ajena, pero sí verlas", async () => {
    const ctxA = await ctxFor(h.db, org, "agenteA");
    const ctxB = await ctxFor(h.db, org, "agenteB");
    const p = await newProperty();
    const m = await addPropertyImage(
      h.db,
      ctxA,
      storage,
      { propertyId: p.id },
      { bytes: await jpeg({ r: 1, g: 2, b: 3 }), fileName: "a.jpg" },
    );
    expect(
      await catchErr(
        addPropertyImage(
          h.db,
          ctxB,
          storage,
          { propertyId: p.id },
          { bytes: await jpeg({ r: 1, g: 2, b: 3 }), fileName: "b.jpg" },
        ),
      ),
    ).toBeInstanceOf(ForbiddenError);
    const read = await readPropertyMedia(h.db, ctxB, storage, m.id, "thumb");
    expect(read.mimeType).toBe("image/webp");
  });

  it("solo acepta videos de YouTube o Vimeo", async () => {
    const ctx = await ctxFor(h.db, org, "agenteA");
    const p = await newProperty();
    const v = await addPropertyVideo(h.db, ctx, { propertyId: p.id, url: "https://youtu.be/abc123" });
    expect(v?.kind).toBe("video");
    expect(
      await catchErr(addPropertyVideo(h.db, ctx, { propertyId: p.id, url: "https://example.com/v.mp4" })),
    ).toBeInstanceOf(ValidationError);
  });
});

describe("publicación", () => {
  it("el checklist bloquea la publicación hasta completar la ficha", async () => {
    const ctx = await ctxFor(h.db, org, "agenteA");
    const p = await newProperty();
    const err = await catchErr(changePropertyStatus(h.db, ctx, { propertyId: p.id, status: "published" }));
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as Error).message).toMatch(/Al menos 3 fotos/);

    for (const c of [10, 20, 30]) {
      await addPropertyImage(
        h.db,
        ctx,
        storage,
        { propertyId: p.id },
        { bytes: await jpeg({ r: c, g: c, b: c }), fileName: "x.jpg" },
      );
    }
    await setPrices(h.db, ctx, {
      propertyId: p.id,
      prices: [{ operation: "sale", currency: "USD", list: "150.000" }],
    });
    const o = await newOwner();
    await setPropertyOwners(h.db, ctx, {
      propertyId: p.id,
      owners: [{ contactId: o.id, sharePercent: "100" }],
    });
    const d = await getProperty(h.db, ctx, p.id);
    expect(d.checklist).toEqual([]);
    const published = await changePropertyStatus(h.db, ctx, { propertyId: p.id, status: "published" });
    expect(published?.status).toBe("published");
    expect(published?.publishedAt).toBeInstanceOf(Date);
  });

  it("transiciones inválidas y baja requieren permisos", async () => {
    const agent = await ctxFor(h.db, org, "agenteA");
    const admin = await ctxFor(h.db, org, "admin");
    const p = await newProperty();
    await changePropertyStatus(h.db, agent, { propertyId: p.id, status: "available" });
    await changePropertyStatus(h.db, agent, { propertyId: p.id, status: "sold" });
    expect(
      await catchErr(changePropertyStatus(h.db, agent, { propertyId: p.id, status: "available" })),
    ).toBeInstanceOf(ConflictError);
    expect(
      await catchErr(changePropertyStatus(h.db, agent, { propertyId: p.id, status: "withdrawn" })),
    ).toBeInstanceOf(ForbiddenError);
    await changePropertyStatus(h.db, admin, {
      propertyId: p.id,
      status: "withdrawn",
      note: "Venta escriturada",
    });
    const audits = await h.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, p.id), eq(auditLog.action, "property.status_change")));
    expect(audits).toHaveLength(3);
  });
});

describe("documentos", () => {
  it("aplica visibilidad interna, restringida y confidencial y audita descargas", async () => {
    const agentA = await ctxFor(h.db, org, "agenteA");
    const agentB = await ctxFor(h.db, org, "agenteB");
    const admin = await ctxFor(h.db, org, "admin");
    const p = await newProperty();
    const base = { entityType: "property", entityId: p.id, category: "property", type: "Plano" };
    const internal = await uploadDocument(
      h.db,
      agentA,
      storage,
      { ...base, name: "Plano interno" },
      { bytes: PDF, fileName: "p.pdf" },
    );
    const restricted = await uploadDocument(
      h.db,
      agentA,
      storage,
      { ...base, name: "Título", visibility: "restricted" },
      { bytes: PDF, fileName: "t.pdf" },
    );
    expect(
      await catchErr(
        uploadDocument(
          h.db,
          agentA,
          storage,
          { ...base, name: "Secreto", visibility: "confidential" },
          { bytes: PDF, fileName: "s.pdf" },
        ),
      ),
    ).toBeInstanceOf(ForbiddenError);
    const confidential = await uploadDocument(
      h.db,
      admin,
      storage,
      { ...base, name: "Secreto", visibility: "confidential" },
      { bytes: PDF, fileName: "s.pdf" },
    );
    expect(internal.sha256).toHaveLength(64);

    const forA = await listEntityDocuments(h.db, agentA, "property", p.id);
    expect(forA.items.map((d) => d.id).sort()).toEqual([internal.id, restricted.id].sort());
    expect(forA.hiddenCount).toBe(1);
    const forB = await listEntityDocuments(h.db, agentB, "property", p.id);
    expect(forB.items.map((d) => d.id)).toEqual([internal.id]);
    expect(forB.canUpload).toBe(false);
    const forAdmin = await listEntityDocuments(h.db, admin, "property", p.id);
    expect(forAdmin.items).toHaveLength(3);

    expect(await catchErr(readDocumentFile(h.db, agentB, storage, { id: restricted.id }))).toBeInstanceOf(
      NotFoundError,
    );
    expect(await catchErr(readDocumentFile(h.db, agentA, storage, { id: confidential.id }))).toBeInstanceOf(
      NotFoundError,
    );
    const file = await readDocumentFile(h.db, agentA, storage, { id: restricted.id });
    expect(file.mimeType).toBe("application/pdf");
    expect(file.body.equals(PDF)).toBe(true);
    const downloads = await h.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, restricted.id), eq(auditLog.action, "document.download")));
    expect(downloads).toHaveLength(1);

    const listA = await listDocuments(h.db, agentA, { q: "secreto" });
    expect(listA.items).toHaveLength(0);
    const listAdmin = await listDocuments(h.db, admin, { q: "secreto" });
    expect(listAdmin.items.some((d) => d.id === confidential.id)).toBe(true);

    await deleteDocument(h.db, agentA, internal.id);
    const after = await listEntityDocuments(h.db, agentA, "property", p.id);
    expect(after.items.map((d) => d.id)).toEqual([restricted.id]);
  });

  it("rechaza tipos de archivo no admitidos", async () => {
    const ctx = await ctxFor(h.db, org, "agenteA");
    const p = await newProperty();
    const err = await catchErr(
      uploadDocument(
        h.db,
        ctx,
        storage,
        { entityType: "property", entityId: p.id, category: "property", type: "Otro", name: "Planilla" },
        { bytes: Buffer.from("PK\u0003\u0004zip"), fileName: "x.pdf" },
      ),
    );
    expect(err).toBeInstanceOf(ValidationError);
  });
});

describe("captaciones y tasaciones", () => {
  it("captar exige autorización y crea la propiedad en borrador con dueño y precio", async () => {
    const ctx = await ctxFor(h.db, org, "agenteA");
    const owner = await newOwner();
    const a = await createAcquisition(h.db, ctx, {
      ownerContactId: owner.id,
      propertyType: "house",
      operation: "sale",
      address: "Av. Italia 1234",
      localityId: geo.localityId,
      exclusive: true,
      exclusiveFrom: "2026-01-01",
      exclusiveUntil: "2026-07-01",
      commissionPercent: "3,5",
      currency: "USD",
      askingPrice: "320.000",
      recommendedPrice: "295.000",
    });
    expect(a.code).toMatch(/^CAP-\d{6}$/);

    for (const stage of ["contacted", "valuation", "negotiation", "authorization"]) {
      await changeAcquisitionStage(h.db, ctx, { id: a.id, stage });
    }
    expect(await catchErr(changeAcquisitionStage(h.db, ctx, { id: a.id, stage: "captured" }))).toBeInstanceOf(
      ValidationError,
    );
    await h.db.update(acquisition).set({ publicationAuthorized: true }).where(eq(acquisition.id, a.id));

    const captured = await changeAcquisitionStage(h.db, ctx, { id: a.id, stage: "captured" });
    expect(captured?.stage).toBe("captured");
    expect(captured?.propertyId).toBeTruthy();
    const d = await getProperty(h.db, ctx, captured?.propertyId ?? "");
    expect(d.property.status).toBe("draft");
    expect(d.property.commissionBasisPoints).toBe(350);
    expect(d.owners[0]?.contactId).toBe(owner.id);
    expect(d.owners[0]?.shareBasisPoints).toBe(10_000);
    expect(d.prices[0]?.listMinor).toBe(29_500_000n);
    expect(d.prices[0]?.ownerAskingMinor).toBe(32_000_000n);

    // Completar la ficha y publicar mueve la captación a "Publicado".
    const pid = d.property.id;
    await updateProperty(h.db, ctx, {
      id: pid,
      type: "house",
      operations: ["sale"],
      title: "Casa con jardín en Av. Italia",
      description: "Casa de tres dormitorios con jardín, parrillero y garaje para dos autos.",
      localityId: geo.localityId,
    });
    for (const c of [1, 2, 3]) {
      await addPropertyImage(
        h.db,
        ctx,
        storage,
        { propertyId: pid },
        { bytes: await jpeg({ r: c * 40, g: 0, b: 0 }), fileName: "x.jpg" },
      );
    }
    await changePropertyStatus(h.db, ctx, { propertyId: pid, status: "published" });
    const [after] = await h.db.select().from(acquisition).where(eq(acquisition.id, a.id));
    expect(after?.stage).toBe("published");

    const list = await listAcquisitions(h.db, ctx, { stage: "published" });
    expect(list.items.some((x) => x.id === a.id)).toBe(true);
  });

  it("perder requiere motivo y un perdido se reabre como prospecto", async () => {
    const ctx = await ctxFor(h.db, org, "agenteA");
    const owner = await newOwner();
    const a = await createAcquisition(h.db, ctx, {
      ownerContactId: owner.id,
      propertyType: "apartment",
      operation: "rent",
    });
    expect(await catchErr(changeAcquisitionStage(h.db, ctx, { id: a.id, stage: "lost" }))).toBeInstanceOf(
      ValidationError,
    );
    await changeAcquisitionStage(h.db, ctx, {
      id: a.id,
      stage: "lost",
      lostReason: "Eligió otra inmobiliaria",
    });
    expect(
      await catchErr(changeAcquisitionStage(h.db, ctx, { id: a.id, stage: "negotiation" })),
    ).toBeInstanceOf(ConflictError);
    const reopened = await changeAcquisitionStage(h.db, ctx, { id: a.id, stage: "prospect" });
    expect(reopened?.lostReason).toBeNull();
  });

  it("el agente solo ve sus captaciones", async () => {
    const ctxB = await ctxFor(h.db, org, "agenteB");
    const owner = await newOwner("agenteB");
    const mine = await createAcquisition(h.db, ctxB, {
      ownerContactId: owner.id,
      propertyType: "land",
      operation: "sale",
    });
    const list = await listAcquisitions(h.db, ctxB, {});
    expect(list.items.every((x) => x.captadorUserId === ctxB.userId)).toBe(true);
    expect(list.items.some((x) => x.id === mine.id)).toBe(true);
    const listA = await listAcquisitions(h.db, await ctxFor(h.db, org, "agenteA"), {});
    expect(listA.items.some((x) => x.id === mine.id)).toBe(false);
  });

  it("las tasaciones son inmutables", async () => {
    const ctx = await ctxFor(h.db, org, "agenteA");
    const p = await newProperty();
    const v = await createValuation(h.db, ctx, {
      propertyId: p.id,
      method: "comparables",
      currency: "USD",
      value: "185.000",
      min: "175.000",
      max: "195.000",
      valuedAt: "2026-03-01",
      comparables: [{ address: "Benito Blanco 900", price: "190.000", areaM2: "75" }],
    });
    expect(v.valueMinor).toBe(18_500_000n);
    const err = (await catchErr(
      h.db.execute(sql`update valuation set value_minor = 1 where id = ${v.id}`),
    )) as {
      message?: string;
      cause?: { message?: string };
    } | null;
    expect(`${err?.message} ${err?.cause?.message ?? ""}`).toMatch(/append-only/);
    // Contabilidad no gestiona tasaciones.
    const acc = await ctxFor(h.db, org, "contable");
    expect(
      await catchErr(
        createValuation(h.db, acc, { propertyId: p.id, method: "cost", value: "1", valuedAt: "2026-03-01" }),
      ),
    ).toBeInstanceOf(ForbiddenError);
  });
});

describe("aislamiento entre organizaciones", () => {
  it("no se accede a propiedades ni archivos de otra organización", async () => {
    const other = await createTestOrg(h.db, "otra-props", { admin: { roleKey: "admin" } });
    const otherAdmin = await ctxFor(h.db, other, "admin");
    const ctx = await ctxFor(h.db, org, "agenteA");
    const p = await newProperty();
    const m = await addPropertyImage(
      h.db,
      ctx,
      storage,
      { propertyId: p.id },
      { bytes: await jpeg({ r: 9, g: 9, b: 9 }), fileName: "a.jpg" },
    );
    expect(await catchErr(getProperty(h.db, otherAdmin, p.id))).toBeInstanceOf(NotFoundError);
    expect(await catchErr(readPropertyMedia(h.db, otherAdmin, storage, m.id, "full"))).toBeInstanceOf(
      NotFoundError,
    );
    const list = await listProperties(h.db, otherAdmin, {});
    expect(list.items).toHaveLength(0);
    const [row] = await h.db
      .select({ n: sql<number>`count(*)::int` })
      .from(property)
      .where(eq(property.organizationId, other.organizationId));
    expect(row?.n).toBe(0);
  });
});
