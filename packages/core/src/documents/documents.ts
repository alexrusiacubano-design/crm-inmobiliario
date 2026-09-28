import { and, count, desc, eq, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { contact, document, documentLink, property, user, type Db, type DbOrTx } from "@crm/db";
import {
  ACCEPTED_DOCUMENT_TYPES,
  MAX_DOCUMENT_BYTES,
  normalizeText,
  sniffMimeType,
  type DocumentVisibility,
} from "@crm/shared";
import type { ResourceRef } from "@crm/shared/rbac";
import {
  documentListSchema,
  documentMetaSchema,
  updateDocumentSchema,
} from "@crm/shared/validation/property";
import { uuidSchema } from "@crm/shared/validation";
import { z } from "zod";
import { scopeCondition } from "../access-filter";
import { writeAudit } from "../audit";
import { hasPermission, requirePermission, type RequestContext } from "../context";
import { contactRef } from "../crm/helpers";
import { ForbiddenError, NotFoundError, ValidationError, parseInput } from "../errors";
import { emitEvent } from "../events";
import { newStorageKey, sha256, type StorageProvider } from "../storage/provider";
import { propertyDisplayTitle, propertyRef } from "../properties/helpers";

type DocRow = typeof document.$inferSelect;
export type DocumentEntityType = "property" | "contact";

interface EntityAccess {
  ref: ResourceRef;
  canRead: boolean;
  canWrite: boolean;
  label: string;
  href: string;
  assignedUserId: string | null;
  branchId: string | null;
  teamId: string | null;
}

async function entityAccess(
  tx: DbOrTx,
  ctx: RequestContext,
  type: DocumentEntityType,
  id: string,
): Promise<EntityAccess | null> {
  if (type === "property") {
    const [p] = await tx
      .select()
      .from(property)
      .where(
        and(eq(property.id, id), eq(property.organizationId, ctx.organizationId), isNull(property.deletedAt)),
      );
    if (!p) return null;
    const ref = propertyRef(p);
    return {
      ref,
      canRead: hasPermission(ctx, "property.read", ref),
      canWrite: hasPermission(ctx, "property.update", ref),
      label: `${p.code} · ${propertyDisplayTitle(p)}`,
      href: `/properties/${p.id}`,
      assignedUserId: p.assignedUserId,
      branchId: p.branchId,
      teamId: p.teamId,
    };
  }
  const [c] = await tx
    .select()
    .from(contact)
    .where(
      and(eq(contact.id, id), eq(contact.organizationId, ctx.organizationId), isNull(contact.deletedAt)),
    );
  if (!c) return null;
  const ref = contactRef(c);
  return {
    ref,
    canRead: hasPermission(ctx, "contact.read", ref) || hasPermission(ctx, "owner.read", ref),
    canWrite: hasPermission(ctx, "contact.update", ref) || hasPermission(ctx, "owner.update", ref),
    label: c.displayName,
    href: `/crm/contacts/${c.id}`,
    assignedUserId: c.assignedUserId,
    branchId: c.branchId,
    teamId: c.teamId,
  };
}

function docRef(d: DocRow): ResourceRef {
  return {
    organizationId: d.organizationId,
    ownerUserId: d.responsibleUserId,
    branchId: d.branchId,
    teamId: d.teamId,
  };
}

/**
 * Reglas de visibilidad:
 * - interno: quien puede ver el registro vinculado y tiene `document.read`;
 * - restringido: `document.read` con alcance sobre el documento (responsable, equipo, sucursal);
 * - confidencial: `document.sensitive.read` con alcance sobre el documento.
 */
export function canReadDocument(ctx: RequestContext, d: DocRow, entityVisible: boolean): boolean {
  if (d.organizationId !== ctx.organizationId || d.deletedAt || !entityVisible) return false;
  switch (d.visibility) {
    case "internal":
      return hasPermission(ctx, "document.read");
    case "restricted":
      return hasPermission(ctx, "document.read", docRef(d));
    case "confidential":
      return hasPermission(ctx, "document.sensitive.read", docRef(d));
  }
}

const uploadSchema = documentMetaSchema;

export async function uploadDocument(
  db: Db,
  ctx: RequestContext,
  storage: StorageProvider,
  rawMeta: unknown,
  file: { bytes: Buffer; fileName: string },
) {
  const meta = parseInput(uploadSchema, rawMeta);
  requirePermission(ctx, "document.manage");
  const entity = await entityAccess(db, ctx, meta.entityType, meta.entityId);
  if (!entity || !entity.canRead) throw new NotFoundError("Registro");
  if (!entity.canWrite) throw new ForbiddenError("No podés agregar documentos a este registro");
  if (meta.visibility === "confidential" && !hasPermission(ctx, "document.sensitive.read", entity.ref)) {
    throw new ForbiddenError("No podés cargar documentos confidenciales");
  }
  if (file.bytes.length === 0) throw new ValidationError("El archivo está vacío");
  if (file.bytes.length > MAX_DOCUMENT_BYTES) throw new ValidationError("El archivo supera los 20 MB");
  const mime = sniffMimeType(file.bytes);
  if (!mime || !(ACCEPTED_DOCUMENT_TYPES as readonly string[]).includes(mime)) {
    throw new ValidationError("Formato no admitido: PDF, JPG, PNG o WebP");
  }
  const ext = mime === "application/pdf" ? "pdf" : (mime.split("/")[1] ?? "bin");
  const key = newStorageKey(ctx.organizationId, "documents", ext);
  await storage.put(key, file.bytes, mime);

  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(document)
        .values({
          organizationId: ctx.organizationId,
          category: meta.category,
          type: meta.type,
          name: meta.name,
          storageKey: key,
          mimeType: mime,
          sizeBytes: file.bytes.length,
          sha256: sha256(file.bytes),
          expiresAt: meta.expiresAt,
          visibility: meta.visibility,
          status: meta.status,
          responsibleUserId: entity.assignedUserId ?? ctx.userId,
          branchId: entity.branchId,
          teamId: entity.teamId,
          createdById: ctx.userId,
        })
        .returning();
      if (!row) throw new Error("No se pudo guardar el documento");
      await tx.insert(documentLink).values({
        documentId: row.id,
        entityType: meta.entityType,
        entityId: meta.entityId,
        organizationId: ctx.organizationId,
      });
      await writeAudit(tx, ctx, {
        action: "document.upload",
        entityType: meta.entityType,
        entityId: meta.entityId,
        after: {
          documentId: row.id,
          type: row.type,
          name: row.name,
          visibility: row.visibility,
          sha256: row.sha256,
        },
      });
      await emitEvent(tx, ctx, {
        type: "document.uploaded",
        aggregateType: meta.entityType,
        aggregateId: meta.entityId,
        payload: { documentId: row.id },
      });
      return row;
    });
  } catch (error) {
    await storage.delete(key).catch(() => undefined);
    throw error;
  }
}

async function loadDocument(tx: DbOrTx, ctx: RequestContext, id: string) {
  const [d] = await tx
    .select()
    .from(document)
    .where(
      and(eq(document.id, id), eq(document.organizationId, ctx.organizationId), isNull(document.deletedAt)),
    );
  if (!d) throw new NotFoundError("Documento");
  const links = await tx.select().from(documentLink).where(eq(documentLink.documentId, id));
  const entities: (EntityAccess | null)[] = [];
  for (const l of links)
    entities.push(await entityAccess(tx, ctx, l.entityType as DocumentEntityType, l.entityId));
  const entityVisible = entities.some((e) => e?.canRead);
  if (!canReadDocument(ctx, d, entityVisible)) throw new NotFoundError("Documento");
  return { d, links, entities };
}

export async function listEntityDocuments(
  db: DbOrTx,
  ctx: RequestContext,
  entityType: DocumentEntityType,
  entityId: string,
) {
  const id = parseInput(uuidSchema, entityId);
  const entity = await entityAccess(db, ctx, entityType, id);
  if (!entity?.canRead) throw new NotFoundError("Registro");
  const rows = await db
    .select({ d: document, uploadedBy: user.name })
    .from(documentLink)
    .innerJoin(document, eq(document.id, documentLink.documentId))
    .leftJoin(user, eq(user.id, document.createdById))
    .where(
      and(
        eq(documentLink.entityType, entityType),
        eq(documentLink.entityId, id),
        eq(documentLink.organizationId, ctx.organizationId),
        isNull(document.deletedAt),
      ),
    )
    .orderBy(desc(document.createdAt));
  const visible = rows.filter((r) => canReadDocument(ctx, r.d, true));
  return {
    items: visible.map((r) => ({
      ...r.d,
      uploadedBy: r.uploadedBy,
      canManage: hasPermission(ctx, "document.manage", docRef(r.d)),
    })),
    hiddenCount: rows.length - visible.length,
    canUpload: hasPermission(ctx, "document.manage") && entity.canWrite,
    canUploadConfidential: hasPermission(ctx, "document.sensitive.read", entity.ref),
  };
}

/** Listado general del expediente, filtrado por alcance en SQL. */
export async function listDocuments(db: DbOrTx, ctx: RequestContext, rawQuery: unknown) {
  requirePermission(ctx, "document.read");
  const q = parseInput(documentListSchema, rawQuery);
  const cols = {
    ownerUserId: document.responsibleUserId,
    branchId: document.branchId,
    teamId: document.teamId,
  };
  const visibilityRule = or(
    and(inArray(document.visibility, ["internal", "restricted"]), scopeCondition(ctx, "document.read", cols)),
    and(eq(document.visibility, "confidential"), scopeCondition(ctx, "document.sensitive.read", cols)),
  );
  const conditions: (SQL | undefined)[] = [
    eq(document.organizationId, ctx.organizationId),
    isNull(document.deletedAt),
    visibilityRule,
  ];
  if (q.category) conditions.push(eq(document.category, q.category));
  if (q.status) conditions.push(eq(document.status, q.status));
  if (q.expiring) {
    const in30 = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    conditions.push(lte(document.expiresAt, in30));
  }
  if (q.q) {
    const term = `%${normalizeText(q.q)}%`;
    conditions.push(
      or(
        sql`lower(unaccent(${document.name})) like ${term}`,
        sql`lower(unaccent(${document.type})) like ${term}`,
      ),
    );
  }
  const where = and(...conditions);

  const [rows, totals] = await Promise.all([
    db
      .select({ d: document, uploadedBy: user.name })
      .from(document)
      .leftJoin(user, eq(user.id, document.createdById))
      .where(where)
      .orderBy(desc(document.createdAt))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ total: count() }).from(document).where(where),
  ]);
  const links = rows.length
    ? await db
        .select()
        .from(documentLink)
        .where(
          inArray(
            documentLink.documentId,
            rows.map((r) => r.d.id),
          ),
        )
    : [];
  const entities = new Map<string, EntityAccess | null>();
  for (const l of links) {
    const k = `${l.entityType}:${l.entityId}`;
    if (!entities.has(k))
      entities.set(k, await entityAccess(db, ctx, l.entityType as DocumentEntityType, l.entityId));
  }
  return {
    items: rows.map((r) => {
      const link = links.find((l) => l.documentId === r.d.id);
      const e = link ? entities.get(`${link.entityType}:${link.entityId}`) : null;
      return {
        ...r.d,
        uploadedBy: r.uploadedBy,
        entity: e?.canRead ? { label: e.label, href: e.href } : { label: "Registro restringido", href: null },
      };
    }),
    total: totals[0]?.total ?? 0,
    page: q.page,
    pageSize: q.pageSize,
  };
}

export async function updateDocumentMeta(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(updateDocumentSchema, rawInput);
  return db.transaction(async (tx) => {
    const { d, entities } = await loadDocument(tx, ctx, input.id);
    requirePermission(ctx, "document.manage", docRef(d));
    const ref = entities.find((e) => e)?.ref;
    if (
      input.visibility === "confidential" &&
      !hasPermission(ctx, "document.sensitive.read", ref ?? docRef(d))
    ) {
      throw new ForbiddenError("No podés marcar documentos como confidenciales");
    }
    const [after] = await tx
      .update(document)
      .set({
        type: input.type,
        name: input.name,
        expiresAt: input.expiresAt,
        visibility: input.visibility as DocumentVisibility,
        status: input.status,
      })
      .where(eq(document.id, d.id))
      .returning();
    await writeAudit(tx, ctx, {
      action: "document.update",
      entityType: "document",
      entityId: d.id,
      before: d,
      after,
    });
    return after;
  });
}

/** Baja lógica: el archivo se conserva (trazabilidad legal) pero deja de listarse. */
export async function deleteDocument(db: Db, ctx: RequestContext, documentId: string) {
  const id = parseInput(uuidSchema, documentId);
  return db.transaction(async (tx) => {
    const { d } = await loadDocument(tx, ctx, id);
    requirePermission(ctx, "document.manage", docRef(d));
    await tx.update(document).set({ deletedAt: new Date() }).where(eq(document.id, d.id));
    await writeAudit(tx, ctx, {
      action: "document.delete",
      entityType: "document",
      entityId: d.id,
      before: d,
    });
  });
}

const readSchema = z.object({ id: uuidSchema });

/** Descarga: verifica permisos y deja constancia en la auditoría. */
export async function readDocumentFile(
  db: Db,
  ctx: RequestContext,
  storage: StorageProvider,
  rawInput: unknown,
) {
  const { id } = parseInput(readSchema, rawInput);
  const { d } = await loadDocument(db, ctx, id);
  await db.transaction((tx) =>
    writeAudit(tx, ctx, {
      action: "document.download",
      entityType: "document",
      entityId: d.id,
      after: { visibility: d.visibility },
    }),
  );
  return { body: await storage.get(d.storageKey), mimeType: d.mimeType, name: d.name };
}
