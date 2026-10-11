import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "@crm/db";
import {
  ForbiddenError,
  getSiteEditor,
  LocalDiskStorage,
  publishSite,
  readSiteHeroImage,
  saveSiteDraft,
  siteContent,
  uploadSiteHeroImage,
} from "../src";
import { createTestOrg, ctxFor, freshDb, type TestOrg } from "./fixtures";

let h: DbHandle;
let org: TestOrg;
let other: TestOrg;
let dir: string;
let storage: LocalDiskStorage;

beforeAll(async () => {
  h = await freshDb();
  org = await createTestOrg(h.db, "site", { admin: { roleKey: "admin" }, agent: { roleKey: "agent" } });
  other = await createTestOrg(h.db, "site2", { admin: { roleKey: "admin" } });
  dir = await mkdtemp(join(tmpdir(), "crm-site-"));
  storage = new LocalDiskStorage(dir);
});
afterAll(async () => {
  await h.pool.end();
  await rm(dir, { recursive: true, force: true });
});

describe("Mi sitio web", () => {
  it("sin configurar usa los valores por defecto", async () => {
    const c = await siteContent(h.db, org.organizationId);
    expect(c.theme).toBe("gold");
    expect(c.heroTitle).toBe("Encontrá la propiedad");
  });

  it("el borrador no se ve hasta publicar; los textos vacíos vuelven al valor por defecto", async () => {
    const admin = await ctxFor(h.db, org, "admin");
    await saveSiteDraft(h.db, admin, {
      theme: "navy",
      heroTitle: "Tu próximo hogar",
      heroHighlight: "",
      heroSubtitle: "Propiedades en Montevideo",
      showWelcome: false,
      showValuation: true,
      valuationTitle: "",
      valuationText: "",
      ctaTitle: "Hablemos",
      footerText: "",
    });
    expect((await siteContent(h.db, org.organizationId)).theme).toBe("gold");
    const draft = await siteContent(h.db, org.organizationId, "draft");
    expect(draft).toMatchObject({
      theme: "navy",
      heroTitle: "Tu próximo hogar",
      heroHighlight: "que estás buscando",
    });
    expect((await getSiteEditor(h.db, admin)).pending).toBe(true);

    await publishSite(h.db, admin);
    const pub = await siteContent(h.db, org.organizationId);
    expect(pub).toMatchObject({ theme: "navy", showWelcome: false, ctaTitle: "Hablemos" });
    expect((await getSiteEditor(h.db, admin)).pending).toBe(false);
  });

  it("solo quien administra la configuración puede editar", async () => {
    const agent = await ctxFor(h.db, org, "agent");
    await expect(saveSiteDraft(h.db, agent, { theme: "light" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(publishSite(h.db, agent)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("la portada subida se sirve solo desde su organización", async () => {
    const admin = await ctxFor(h.db, org, "admin");
    const png = await sharp({ create: { width: 800, height: 400, channels: 3, background: "#336699" } })
      .png()
      .toBuffer();
    const { heroImageKey } = await uploadSiteHeroImage(h.db, admin, storage, {
      bytes: png,
      fileName: "p.png",
    });
    expect((await siteContent(h.db, org.organizationId, "draft")).heroImageKey).toBe(heroImageKey);
    expect(await readSiteHeroImage(h.db, storage, org.organizationId, heroImageKey)).not.toBeNull();
    expect(await readSiteHeroImage(h.db, storage, other.organizationId, heroImageKey)).toBeNull();
    // Una clave que no es la portada no se sirve aunque exista.
    expect(
      await readSiteHeroImage(h.db, storage, org.organizationId, `${org.organizationId}/branding/x.png`),
    ).toBeNull();

    // Guardar textos no pisa la imagen; quitarla sí.
    await saveSiteDraft(h.db, admin, { theme: "light" });
    expect((await siteContent(h.db, org.organizationId, "draft")).heroImageKey).toBe(heroImageKey);
    await saveSiteDraft(h.db, admin, { theme: "light", removeHeroImage: true });
    expect((await siteContent(h.db, org.organizationId, "draft")).heroImageKey).toBeNull();
  });
});
