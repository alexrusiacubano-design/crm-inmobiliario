import { eq } from "drizzle-orm";
import sharp from "sharp";
import { siteSettings, type Db, type DbOrTx } from "@crm/db";
import { ACCEPTED_IMAGE_TYPES, sniffMimeType } from "@crm/shared";
import { siteContentInputSchema, siteContentOf, type SiteContent } from "@crm/shared/site";
import { writeAudit } from "../audit";
import { requirePermission, type RequestContext } from "../context";
import { parseInput, ValidationError } from "../errors";
import { newStorageKey, type StorageProvider } from "../storage/provider";

export const MAX_SITE_IMAGE_BYTES = 10 * 1024 * 1024;

export interface SiteEditorState {
  draft: SiteContent;
  published: SiteContent | null;
  publishedAt: Date | null;
  /** Hay cambios guardados que todavía no se publicaron. */
  pending: boolean;
}

async function row(db: DbOrTx, organizationId: string) {
  const [r] = await db.select().from(siteSettings).where(eq(siteSettings.organizationId, organizationId));
  return r ?? null;
}

/** Contenido que ve el público (o el borrador, para la vista previa). */
export async function siteContent(
  db: DbOrTx,
  organizationId: string,
  version: "published" | "draft" = "published",
): Promise<SiteContent> {
  const r = await row(db, organizationId);
  return siteContentOf(version === "draft" ? (r?.draft ?? r?.published) : r?.published);
}

export async function getSiteEditor(db: DbOrTx, ctx: RequestContext): Promise<SiteEditorState> {
  requirePermission(ctx, "settings.manage");
  const r = await row(db, ctx.organizationId);
  const draft = siteContentOf(r?.draft ?? r?.published);
  const published = r?.published ? siteContentOf(r.published) : null;
  return {
    draft,
    published,
    publishedAt: r?.publishedAt ?? null,
    pending: !published || JSON.stringify(draft) !== JSON.stringify(published),
  };
}

/** Guarda el borrador. La imagen de portada se sube aparte; acá solo se puede quitar. */
export async function saveSiteDraft(db: Db, ctx: RequestContext, rawInput: unknown): Promise<SiteContent> {
  requirePermission(ctx, "settings.manage");
  const { removeHeroImage, ...input } = parseInput(siteContentInputSchema, rawInput);
  return db.transaction(async (tx) => {
    const current = await row(tx, ctx.organizationId);
    const prev = siteContentOf(current?.draft ?? current?.published);
    const next = siteContentOf({ ...input, heroImageKey: removeHeroImage ? null : prev.heroImageKey });
    await tx
      .insert(siteSettings)
      .values({ organizationId: ctx.organizationId, draft: next })
      .onConflictDoUpdate({
        target: siteSettings.organizationId,
        set: { draft: next, updatedAt: new Date() },
      });
    await writeAudit(tx, ctx, {
      action: "site.draft.save",
      entityType: "organization",
      entityId: ctx.organizationId,
      before: prev,
      after: next,
    });
    return next;
  });
}

/** Publica el borrador: desde ahora el sitio muestra esta versión. */
export async function publishSite(db: Db, ctx: RequestContext): Promise<SiteContent> {
  requirePermission(ctx, "settings.manage");
  return db.transaction(async (tx) => {
    const current = await row(tx, ctx.organizationId);
    const content = siteContentOf(current?.draft ?? current?.published);
    const now = new Date();
    await tx
      .insert(siteSettings)
      .values({
        organizationId: ctx.organizationId,
        draft: content,
        published: content,
        publishedAt: now,
        publishedById: ctx.userId,
      })
      .onConflictDoUpdate({
        target: siteSettings.organizationId,
        set: { published: content, publishedAt: now, publishedById: ctx.userId, updatedAt: now },
      });
    await writeAudit(tx, ctx, {
      action: "site.publish",
      entityType: "organization",
      entityId: ctx.organizationId,
      before: current?.published ?? null,
      after: content,
    });
    return content;
  });
}

/** Sube la imagen de portada al borrador (WebP de hasta 2400 px de ancho). */
export async function uploadSiteHeroImage(
  db: Db,
  ctx: RequestContext,
  storage: StorageProvider,
  file: { bytes: Buffer; fileName: string },
): Promise<{ heroImageKey: string }> {
  requirePermission(ctx, "settings.manage");
  if (file.bytes.length === 0) throw new ValidationError("El archivo está vacío");
  if (file.bytes.length > MAX_SITE_IMAGE_BYTES) throw new ValidationError("La imagen supera los 10 MB");
  const mime = sniffMimeType(file.bytes);
  if (!mime || !(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(mime)) {
    throw new ValidationError("Formato no admitido: usá JPG, PNG o WebP");
  }
  let webp: Buffer;
  try {
    webp = await sharp(file.bytes, { failOn: "error", limitInputPixels: 60_000_000 })
      .rotate()
      .resize({ width: 2400, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    throw new ValidationError("La imagen está dañada o no se puede leer");
  }
  const key = newStorageKey(ctx.organizationId, "site", "webp");
  await storage.put(key, webp, "image/webp");
  await db.transaction(async (tx) => {
    const current = await row(tx, ctx.organizationId);
    const draft = { ...siteContentOf(current?.draft ?? current?.published), heroImageKey: key };
    await tx
      .insert(siteSettings)
      .values({ organizationId: ctx.organizationId, draft })
      .onConflictDoUpdate({ target: siteSettings.organizationId, set: { draft, updatedAt: new Date() } });
    await writeAudit(tx, ctx, {
      action: "site.hero.upload",
      entityType: "organization",
      entityId: ctx.organizationId,
      after: { heroImageKey: key },
    });
  });
  return { heroImageKey: key };
}

/**
 * Imagen de portada para la ruta pública: solo si es la del borrador o la publicada de esa
 * organización (no permite leer otros archivos del almacenamiento).
 */
export async function readSiteHeroImage(
  db: DbOrTx,
  storage: StorageProvider,
  organizationId: string,
  key: string,
): Promise<Buffer | null> {
  const r = await row(db, organizationId);
  if (!r) return null;
  const allowed = [
    siteContentOf(r.draft).heroImageKey,
    r.published ? siteContentOf(r.published).heroImageKey : null,
  ];
  if (!allowed.includes(key)) return null;
  return storage.get(key).catch(() => null);
}
