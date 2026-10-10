import { eq } from "drizzle-orm";
import sharp from "sharp";
import { organization, type Db, type DbOrTx } from "@crm/db";
import { ACCEPTED_IMAGE_TYPES, sniffMimeType } from "@crm/shared";
import { writeAudit } from "../audit";
import { orgLogoUrl, requirePermission, type RequestContext } from "../context";
import { ValidationError } from "../errors";
import { newStorageKey, type StorageProvider } from "../storage/provider";

export const MAX_LOGO_BYTES = 5 * 1024 * 1024;

/**
 * Normaliza el logo: respeta la orientación, quita metadatos, recorta el margen vacío
 * alrededor y lo deja en PNG de hasta 512 px (con transparencia si la tiene).
 */
export async function processLogo(input: Buffer): Promise<Buffer> {
  const base = sharp(input, { failOn: "error", limitInputPixels: 40_000_000 }).rotate();
  let img = base;
  try {
    img = sharp(await base.clone().trim({ threshold: 12 }).toBuffer());
  } catch {
    img = base; // imagen de un solo color: no se recorta
  }
  return img
    .resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

export async function setOrganizationLogo(
  db: Db,
  ctx: RequestContext,
  storage: StorageProvider,
  file: { bytes: Buffer; fileName: string },
): Promise<{ logoUrl: string | null }> {
  requirePermission(ctx, "settings.manage");
  if (file.bytes.length === 0) throw new ValidationError("El archivo está vacío");
  if (file.bytes.length > MAX_LOGO_BYTES) throw new ValidationError("El logo supera los 5 MB");
  const mime = sniffMimeType(file.bytes);
  if (!mime || !(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(mime)) {
    throw new ValidationError("Formato no admitido: usá PNG, JPG o WebP");
  }
  let png: Buffer;
  try {
    png = await processLogo(file.bytes);
  } catch {
    throw new ValidationError("La imagen está dañada o no se puede leer");
  }

  const key = newStorageKey(ctx.organizationId, "branding", "png");
  await storage.put(key, png, "image/png");
  const now = new Date();
  const previous = await db.transaction(async (tx) => {
    const [before] = await tx
      .select({ logoKey: organization.logoKey })
      .from(organization)
      .where(eq(organization.id, ctx.organizationId));
    await tx
      .update(organization)
      .set({ logoKey: key, logoUpdatedAt: now })
      .where(eq(organization.id, ctx.organizationId));
    await writeAudit(tx, ctx, {
      action: "organization.logo.update",
      entityType: "organization",
      entityId: ctx.organizationId,
      before: { logoKey: before?.logoKey ?? null },
      after: { logoKey: key },
    });
    return before?.logoKey ?? null;
  });
  if (previous) await storage.delete(previous).catch(() => undefined);
  return { logoUrl: orgLogoUrl(ctx.organizationId, key, now) };
}

export async function removeOrganizationLogo(
  db: Db,
  ctx: RequestContext,
  storage: StorageProvider,
): Promise<void> {
  requirePermission(ctx, "settings.manage");
  const previous = await db.transaction(async (tx) => {
    const [before] = await tx
      .select({ logoKey: organization.logoKey })
      .from(organization)
      .where(eq(organization.id, ctx.organizationId));
    if (!before?.logoKey) return null;
    await tx
      .update(organization)
      .set({ logoKey: null, logoUpdatedAt: new Date() })
      .where(eq(organization.id, ctx.organizationId));
    await writeAudit(tx, ctx, {
      action: "organization.logo.remove",
      entityType: "organization",
      entityId: ctx.organizationId,
      before: { logoKey: before.logoKey },
      after: { logoKey: null },
    });
    return before.logoKey;
  });
  if (previous) await storage.delete(previous).catch(() => undefined);
}

/** Logo para la ruta pública (es imagen de marca, no un dato privado). */
export async function readOrganizationLogo(
  db: DbOrTx,
  storage: StorageProvider,
  organizationId: string,
): Promise<Buffer | null> {
  const [org] = await db
    .select({ logoKey: organization.logoKey })
    .from(organization)
    .where(eq(organization.id, organizationId));
  if (!org?.logoKey) return null;
  return storage.get(org.logoKey).catch(() => null);
}

/**
 * Marca para pantallas sin sesión (inicio de sesión): la organización real con logo.
 * En una instalación con una sola inmobiliaria es la suya.
 */
export async function publicBrand(db: DbOrTx): Promise<{ name: string; logoUrl: string | null } | null> {
  const rows = await db
    .select({
      id: organization.id,
      name: organization.name,
      logoKey: organization.logoKey,
      logoUpdatedAt: organization.logoUpdatedAt,
    })
    .from(organization)
    .where(eq(organization.isDemo, false))
    .limit(2);
  if (rows.length !== 1) return null;
  const o = rows[0];
  if (!o) return null;
  return { name: o.name, logoUrl: orgLogoUrl(o.id, o.logoKey, o.logoUpdatedAt) };
}
