import { and, asc, eq, isNull, max, sql } from "drizzle-orm";
import { property, propertyMedia, type Db, type DbOrTx } from "@crm/db";
import { ACCEPTED_IMAGE_TYPES, MAX_IMAGE_BYTES, sniffMimeType } from "@crm/shared";
import { mediaUpdateSchema, reorderMediaSchema, videoLinkSchema } from "@crm/shared/validation/property";
import { uuidSchema } from "@crm/shared/validation";
import { z } from "zod";
import { writeAudit } from "../audit";
import { hasPermission, requirePermission, type RequestContext } from "../context";
import { NotFoundError, ValidationError, parseInput } from "../errors";
import { emitEvent } from "../events";
import { processImage } from "../storage/images";
import { newStorageKey, type StorageProvider } from "../storage/provider";
import { propertyRef } from "./helpers";

async function loadProperty(tx: DbOrTx, ctx: RequestContext, id: string, forUpdate = false) {
  const q = tx
    .select()
    .from(property)
    .where(
      and(eq(property.id, id), eq(property.organizationId, ctx.organizationId), isNull(property.deletedAt)),
    );
  const [row] = forUpdate ? await q.for("update") : await q;
  if (!row) throw new NotFoundError("Propiedad");
  return row;
}

async function nextPosition(tx: DbOrTx, propertyId: string): Promise<number> {
  const [row] = await tx
    .select({ m: max(propertyMedia.position) })
    .from(propertyMedia)
    .where(eq(propertyMedia.propertyId, propertyId));
  return (row?.m ?? -1) + 1;
}

const uploadSchema = z.object({
  propertyId: uuidSchema,
  kind: z.enum(["photo", "floor_plan"]).default("photo"),
});

/**
 * Sube una foto o plano. El tipo se verifica por el contenido (no por la extensión), se
 * eliminan los metadatos EXIF y se genera una miniatura. Si falla la base de datos, los
 * archivos subidos se borran para no dejar huérfanos.
 */
export async function addPropertyImage(
  db: Db,
  ctx: RequestContext,
  storage: StorageProvider,
  rawInput: unknown,
  file: { bytes: Buffer; fileName: string },
) {
  const input = parseInput(uploadSchema, rawInput);
  const p = await loadProperty(db, ctx, input.propertyId);
  requirePermission(ctx, "property.update", propertyRef(p));

  if (file.bytes.length === 0) throw new ValidationError("El archivo está vacío");
  if (file.bytes.length > MAX_IMAGE_BYTES) throw new ValidationError("La imagen supera los 12 MB");
  const mime = sniffMimeType(file.bytes);
  if (!mime || !(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(mime)) {
    throw new ValidationError("Formato no admitido: usá JPG, PNG o WebP");
  }
  let processed: Awaited<ReturnType<typeof processImage>>;
  try {
    processed = await processImage(file.bytes);
  } catch {
    throw new ValidationError("La imagen está dañada o no se puede leer");
  }

  const key = newStorageKey(ctx.organizationId, `properties/${p.id}`, "webp");
  const thumbKey = key.replace(/\.webp$/, ".thumb.webp");
  await storage.put(key, processed.display, "image/webp");
  await storage.put(thumbKey, processed.thumb, "image/webp");

  try {
    return await db.transaction(async (tx) => {
      await loadProperty(tx, ctx, p.id, true);
      const [hasCover] = await tx
        .select({ id: propertyMedia.id })
        .from(propertyMedia)
        .where(and(eq(propertyMedia.propertyId, p.id), eq(propertyMedia.isCover, true)));
      const [row] = await tx
        .insert(propertyMedia)
        .values({
          organizationId: ctx.organizationId,
          propertyId: p.id,
          kind: input.kind,
          storageKey: key,
          thumbKey,
          mimeType: "image/webp",
          sizeBytes: processed.display.length,
          width: processed.width,
          height: processed.height,
          caption: null,
          position: await nextPosition(tx, p.id),
          // La primera foto queda como portada.
          isCover: input.kind === "photo" && !hasCover,
          createdById: ctx.userId,
        })
        .returning();
      if (!row) throw new Error("No se pudo guardar la imagen");
      await writeAudit(tx, ctx, {
        action: "property.media_add",
        entityType: "property",
        entityId: p.id,
        after: { mediaId: row.id, kind: row.kind, fileName: file.fileName.slice(0, 120) },
      });
      await emitEvent(tx, ctx, {
        type: "property.media_added",
        aggregateType: "property",
        aggregateId: p.id,
      });
      return row;
    });
  } catch (error) {
    await Promise.allSettled([storage.delete(key), storage.delete(thumbKey)]);
    throw error;
  }
}

export async function addPropertyVideo(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(videoLinkSchema, rawInput);
  return db.transaction(async (tx) => {
    const p = await loadProperty(tx, ctx, input.propertyId, true);
    requirePermission(ctx, "property.update", propertyRef(p));
    const [row] = await tx
      .insert(propertyMedia)
      .values({
        organizationId: ctx.organizationId,
        propertyId: p.id,
        kind: "video",
        url: input.url,
        caption: input.caption,
        position: await nextPosition(tx, p.id),
        createdById: ctx.userId,
      })
      .returning();
    await writeAudit(tx, ctx, {
      action: "property.media_add",
      entityType: "property",
      entityId: p.id,
      after: { kind: "video", url: input.url },
    });
    return row;
  });
}

async function loadMediaForWrite(tx: DbOrTx, ctx: RequestContext, mediaId: string) {
  const [row] = await tx
    .select({ m: propertyMedia, p: property })
    .from(propertyMedia)
    .innerJoin(property, eq(property.id, propertyMedia.propertyId))
    .where(
      and(
        eq(propertyMedia.id, mediaId),
        eq(propertyMedia.organizationId, ctx.organizationId),
        isNull(property.deletedAt),
      ),
    );
  if (!row) throw new NotFoundError("Archivo");
  requirePermission(ctx, "property.update", propertyRef(row.p));
  return row;
}

/** Reordena: `orderedIds` debe contener exactamente los archivos de la propiedad. */
export async function reorderPropertyMedia(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(reorderMediaSchema, rawInput);
  return db.transaction(async (tx) => {
    const p = await loadProperty(tx, ctx, input.propertyId, true);
    requirePermission(ctx, "property.update", propertyRef(p));
    const current = await tx
      .select({ id: propertyMedia.id })
      .from(propertyMedia)
      .where(eq(propertyMedia.propertyId, p.id));
    const same =
      current.length === input.orderedIds.length && current.every((c) => input.orderedIds.includes(c.id));
    if (!same) throw new ValidationError("La lista de archivos cambió; recargá la página");
    for (const [position, id] of input.orderedIds.entries()) {
      await tx.update(propertyMedia).set({ position }).where(eq(propertyMedia.id, id));
    }
    await writeAudit(tx, ctx, {
      action: "property.media_reorder",
      entityType: "property",
      entityId: p.id,
      after: input.orderedIds,
    });
  });
}

export async function setPropertyCover(db: Db, ctx: RequestContext, mediaId: string) {
  const id = parseInput(uuidSchema, mediaId);
  return db.transaction(async (tx) => {
    const { m, p } = await loadMediaForWrite(tx, ctx, id);
    if (m.kind !== "photo") throw new ValidationError("Solo una foto puede ser portada");
    await tx
      .update(propertyMedia)
      .set({ isCover: false })
      .where(and(eq(propertyMedia.propertyId, p.id), eq(propertyMedia.isCover, true)));
    await tx.update(propertyMedia).set({ isCover: true }).where(eq(propertyMedia.id, id));
    await writeAudit(tx, ctx, {
      action: "property.media_cover",
      entityType: "property",
      entityId: p.id,
      after: { mediaId: id },
    });
  });
}

export async function updatePropertyMedia(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(mediaUpdateSchema, rawInput);
  return db.transaction(async (tx) => {
    const { m, p } = await loadMediaForWrite(tx, ctx, input.mediaId);
    const kind = m.kind === "video" ? "video" : (input.kind ?? m.kind);
    await tx
      .update(propertyMedia)
      .set({ caption: input.caption, kind, ...(kind !== "photo" ? { isCover: false } : {}) })
      .where(eq(propertyMedia.id, m.id));
    await writeAudit(tx, ctx, {
      action: "property.media_update",
      entityType: "property",
      entityId: p.id,
      after: { mediaId: m.id, caption: input.caption, kind },
    });
  });
}

/** Elimina el archivo. Si era la portada, la siguiente foto pasa a serlo. */
export async function deletePropertyMedia(
  db: Db,
  ctx: RequestContext,
  storage: StorageProvider,
  mediaId: string,
) {
  const id = parseInput(uuidSchema, mediaId);
  const removed = await db.transaction(async (tx) => {
    const { m, p } = await loadMediaForWrite(tx, ctx, id);
    await tx.delete(propertyMedia).where(eq(propertyMedia.id, id));
    if (m.isCover) {
      const [next] = await tx
        .select({ id: propertyMedia.id })
        .from(propertyMedia)
        .where(and(eq(propertyMedia.propertyId, p.id), eq(propertyMedia.kind, "photo")))
        .orderBy(asc(propertyMedia.position))
        .limit(1);
      if (next) await tx.update(propertyMedia).set({ isCover: true }).where(eq(propertyMedia.id, next.id));
    }
    // Compacta posiciones.
    await tx.execute(sql`
      update property_media pm set position = r.rn - 1
      from (select id, row_number() over (order by position) as rn from property_media where property_id = ${p.id}) r
      where pm.id = r.id`);
    await writeAudit(tx, ctx, {
      action: "property.media_delete",
      entityType: "property",
      entityId: p.id,
      before: { mediaId: m.id, kind: m.kind },
    });
    return m;
  });
  // El archivo se borra después del commit: si falla, queda un huérfano, nunca un registro roto.
  await Promise.allSettled(
    [removed.storageKey, removed.thumbKey].filter((k): k is string => !!k).map((k) => storage.delete(k)),
  );
}

/** Lectura para servir una imagen: verifica que el usuario pueda ver la propiedad. */
export async function readPropertyMedia(
  db: DbOrTx,
  ctx: RequestContext,
  storage: StorageProvider,
  mediaId: string,
  size: "full" | "thumb",
): Promise<{ body: Buffer; mimeType: string }> {
  const id = parseInput(uuidSchema, mediaId);
  const [row] = await db
    .select({ m: propertyMedia, p: property })
    .from(propertyMedia)
    .innerJoin(property, eq(property.id, propertyMedia.propertyId))
    .where(and(eq(propertyMedia.id, id), eq(propertyMedia.organizationId, ctx.organizationId)));
  if (!row || row.p.deletedAt || !hasPermission(ctx, "property.read", propertyRef(row.p)))
    throw new NotFoundError("Archivo");
  const key = size === "thumb" ? (row.m.thumbKey ?? row.m.storageKey) : row.m.storageKey;
  if (!key) throw new NotFoundError("Archivo");
  return { body: await storage.get(key), mimeType: row.m.mimeType ?? "image/webp" };
}
