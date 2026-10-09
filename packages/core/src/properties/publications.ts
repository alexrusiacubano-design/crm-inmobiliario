import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  commissionSettings,
  exchangeRate,
  locality,
  neighborhood,
  portalAccount,
  property,
  propertyMedia,
  propertyPrice,
  propertyPublication,
  user,
  type Db,
  type DbOrTx,
} from "@crm/db";
import {
  AD_LEVEL_LABELS,
  PORTAL_LABELS,
  PORTALS,
  PUBLICATION_STATUS_LABELS,
  canTransitionPublication,
  publicationAlerts,
  quotaLeft,
  type AdLevel,
  type Portal,
  type PublicationStatus,
} from "@crm/shared";
import {
  exchangeRateSchema,
  portalAccountSchema,
  publicationStatusSchema,
  publicationUpdateSchema,
  publishSchema,
} from "@crm/shared/validation/publications";
import { uuidSchema } from "@crm/shared/validation";
import { writeAudit } from "../audit";
import { hasPermission, requirePermission, type RequestContext } from "../context";
import { ConflictError, NotFoundError, ValidationError, parseInput } from "../errors";
import { emitEvent } from "../events";
import { propertyDisplayTitle, propertyRef, syncPropertySearch } from "./helpers";
import { checklistFor } from "./properties";

const OFFERABLE = ["available", "published", "negotiating"] as const;
const newToken = () => randomBytes(24).toString("hex");

/** Cuentas de portales (se crean desactivadas la primera vez). */
export async function listPortalAccounts(db: Db, ctx: RequestContext) {
  if (!hasPermission(ctx, "integrations.manage") && !hasPermission(ctx, "publication.read"))
    requirePermission(ctx, "integrations.manage");
  const existing = await db
    .select()
    .from(portalAccount)
    .where(eq(portalAccount.organizationId, ctx.organizationId));
  const missing = PORTALS.filter((p) => !existing.some((e) => e.portal === p));
  if (missing.length)
    await db
      .insert(portalAccount)
      .values(
        missing.map((portal) => ({
          organizationId: ctx.organizationId,
          portal,
          enabled: portal === "website",
          feedToken: newToken(),
        })),
      )
      .onConflictDoNothing();
  const rows = await db
    .select()
    .from(portalAccount)
    .where(eq(portalAccount.organizationId, ctx.organizationId))
    .orderBy(asc(portalAccount.portal));
  const canSeeTokens = hasPermission(ctx, "integrations.manage");
  // Las credenciales cifradas nunca salen del servidor.
  return rows.map(({ credentialsEncrypted, tokensEncrypted, ...r }) => ({
    ...r,
    feedToken: canSeeTokens ? r.feedToken : null,
    credentialHints: canSeeTokens ? r.credentialHints : {},
    hasCredentials: Boolean(credentialsEncrypted),
    connected: Boolean(tokensEncrypted),
  }));
}

export async function savePortalAccount(db: Db, ctx: RequestContext, rawInput: unknown) {
  requirePermission(ctx, "integrations.manage");
  const input = parseInput(portalAccountSchema, rawInput);
  await listPortalAccounts(db, ctx);
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(portalAccount)
      .where(
        and(eq(portalAccount.organizationId, ctx.organizationId), eq(portalAccount.portal, input.portal)),
      );
    if (!before) throw new NotFoundError("Portal");
    const [after] = await tx
      .update(portalAccount)
      .set({ enabled: input.enabled, accountRef: input.accountRef, quotas: input.quotas })
      .where(eq(portalAccount.id, before.id))
      .returning();
    await writeAudit(tx, ctx, {
      action: "portal.update",
      entityType: "portal_account",
      entityId: before.id,
      before: { enabled: before.enabled, accountRef: before.accountRef, quotas: before.quotas },
      after: { enabled: input.enabled, accountRef: input.accountRef, quotas: input.quotas },
    });
    return after;
  });
}

/** Nuevo token del feed (el anterior deja de funcionar). */
export async function rotateFeedToken(db: Db, ctx: RequestContext, portal: Portal) {
  requirePermission(ctx, "integrations.manage");
  return db.transaction(async (tx) => {
    const [after] = await tx
      .update(portalAccount)
      .set({ feedToken: newToken() })
      .where(and(eq(portalAccount.organizationId, ctx.organizationId), eq(portalAccount.portal, portal)))
      .returning();
    if (!after) throw new NotFoundError("Portal");
    await writeAudit(tx, ctx, {
      action: "portal.rotate_token",
      entityType: "portal_account",
      entityId: after.id,
    });
    return after;
  });
}

async function usedByLevel(tx: DbOrTx, organizationId: string, portal: Portal) {
  const rows = await tx
    .select({ level: propertyPublication.level, n: sql<number>`count(*)::int` })
    .from(propertyPublication)
    .where(
      and(
        eq(propertyPublication.organizationId, organizationId),
        eq(propertyPublication.portal, portal),
        eq(propertyPublication.status, "published"),
      ),
    )
    .groupBy(propertyPublication.level);
  return Object.fromEntries(rows.map((r) => [r.level, r.n])) as Partial<Record<AdLevel, number>>;
}

/** Publica (o vuelve a publicar) una propiedad en un portal. Exige el checklist de publicación. */
export async function publishProperty(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(publishSchema, rawInput);
  return db.transaction(async (tx) => {
    const [p] = await tx
      .select()
      .from(property)
      .where(
        and(
          eq(property.id, input.propertyId),
          eq(property.organizationId, ctx.organizationId),
          isNull(property.deletedAt),
        ),
      )
      .for("update");
    if (!p || !hasPermission(ctx, "property.read", propertyRef(p))) throw new NotFoundError("Propiedad");
    requirePermission(ctx, "publication.manage", propertyRef(p));
    if (!(OFFERABLE as readonly string[]).includes(p.status))
      throw new ConflictError("La propiedad no está disponible para publicar");
    const missing = await checklistFor(tx, p);
    if (missing.length) throw new ConflictError(`Falta para publicar: ${missing.join(", ")}`);
    const [account] = await tx
      .select()
      .from(portalAccount)
      .where(
        and(eq(portalAccount.organizationId, ctx.organizationId), eq(portalAccount.portal, input.portal)),
      );
    if (!account?.enabled)
      throw new ConflictError(
        `${PORTAL_LABELS[input.portal]} no está activo (Administración → Integraciones)`,
      );
    const [existing] = await tx
      .select()
      .from(propertyPublication)
      .where(and(eq(propertyPublication.propertyId, p.id), eq(propertyPublication.portal, input.portal)));
    if (existing?.status === "published") throw new ConflictError("Ya está publicada en ese portal");
    const left = quotaLeft(
      account.quotas,
      await usedByLevel(tx, ctx.organizationId, input.portal),
      input.level,
    );
    if (left !== null && left <= 0)
      throw new ConflictError(
        `Sin cupo de avisos ${AD_LEVEL_LABELS[input.level]} en ${PORTAL_LABELS[input.portal]}: bajá otro o elegí otro nivel`,
      );
    const now = new Date();
    const values = {
      level: input.level,
      status: "published" as const,
      externalId: input.externalId,
      url: input.url,
      expiresAt: input.expiresAt,
      notes: input.notes,
      publishedAt: now,
      statusChangedAt: now,
    };
    const [row] = existing
      ? await tx
          .update(propertyPublication)
          .set(values)
          .where(eq(propertyPublication.id, existing.id))
          .returning()
      : await tx
          .insert(propertyPublication)
          .values({
            ...values,
            organizationId: ctx.organizationId,
            propertyId: p.id,
            portal: input.portal,
            createdById: ctx.userId,
          })
          .returning();
    if (p.status === "available") {
      await tx
        .update(property)
        .set({ status: "published", statusChangedAt: now, publishedAt: p.publishedAt ?? now })
        .where(eq(property.id, p.id));
      await writeAudit(tx, ctx, {
        action: "property.status_change",
        entityType: "property",
        entityId: p.id,
        before: { status: p.status },
        after: {
          status: "published",
          automatic: true,
          reason: `Publicada en ${PORTAL_LABELS[input.portal]}`,
        },
      });
      await syncPropertySearch(tx, [p.id]);
    }
    await writeAudit(tx, ctx, {
      action: "publication.publish",
      entityType: "property",
      entityId: p.id,
      after: { portal: input.portal, level: input.level, publicationId: row?.id },
    });
    await emitEvent(tx, ctx, {
      type: "publication.published",
      aggregateType: "property",
      aggregateId: p.id,
      payload: { portal: input.portal, level: input.level },
    });
    return row;
  });
}

async function loadPublication(tx: DbOrTx, ctx: RequestContext, id: string) {
  const [row] = await tx
    .select({ pub: propertyPublication, p: property })
    .from(propertyPublication)
    .innerJoin(property, eq(property.id, propertyPublication.propertyId))
    .where(and(eq(propertyPublication.id, id), eq(propertyPublication.organizationId, ctx.organizationId)))
    .for("update", { of: propertyPublication });
  if (!row || !hasPermission(ctx, "property.read", propertyRef(row.p))) throw new NotFoundError("Aviso");
  requirePermission(ctx, "publication.manage", propertyRef(row.p));
  return row;
}

export async function updatePublication(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(publicationUpdateSchema, rawInput);
  return db.transaction(async (tx) => {
    const { pub } = await loadPublication(tx, ctx, input.id);
    if (input.level !== pub.level && pub.status === "published") {
      const [account] = await tx
        .select()
        .from(portalAccount)
        .where(
          and(eq(portalAccount.organizationId, ctx.organizationId), eq(portalAccount.portal, pub.portal)),
        );
      const used = await usedByLevel(tx, ctx.organizationId, pub.portal);
      const left = quotaLeft(account?.quotas ?? {}, used, input.level);
      if (left !== null && left <= 0)
        throw new ConflictError(
          `Sin cupo de avisos ${AD_LEVEL_LABELS[input.level]} en ${PORTAL_LABELS[pub.portal]}`,
        );
    }
    const [after] = await tx
      .update(propertyPublication)
      .set({
        level: input.level,
        externalId: input.externalId,
        url: input.url,
        expiresAt: input.expiresAt,
        views: input.views ?? null,
        contacts: input.contacts ?? null,
        notes: input.notes,
      })
      .where(eq(propertyPublication.id, pub.id))
      .returning();
    await writeAudit(tx, ctx, {
      action: "publication.update",
      entityType: "property",
      entityId: pub.propertyId,
      before: pub,
      after,
    });
    return after;
  });
}

export async function changePublicationStatus(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(publicationStatusSchema, rawInput);
  return db.transaction(async (tx) => {
    const { pub, p } = await loadPublication(tx, ctx, input.id);
    if (!canTransitionPublication(pub.status, input.status))
      throw new ConflictError(
        `No se puede pasar de ${PUBLICATION_STATUS_LABELS[pub.status]} a ${PUBLICATION_STATUS_LABELS[input.status]}`,
      );
    if (input.status === "published") {
      if (!(OFFERABLE as readonly string[]).includes(p.status))
        throw new ConflictError("La propiedad no está disponible para publicar");
      const [account] = await tx
        .select()
        .from(portalAccount)
        .where(
          and(eq(portalAccount.organizationId, ctx.organizationId), eq(portalAccount.portal, pub.portal)),
        );
      if (!account?.enabled) throw new ConflictError(`${PORTAL_LABELS[pub.portal]} no está activo`);
      const left = quotaLeft(
        account.quotas,
        await usedByLevel(tx, ctx.organizationId, pub.portal),
        pub.level,
      );
      if (left !== null && left <= 0)
        throw new ConflictError(`Sin cupo de avisos ${AD_LEVEL_LABELS[pub.level]}`);
    }
    const [after] = await tx
      .update(propertyPublication)
      .set({ status: input.status, statusChangedAt: new Date() })
      .where(eq(propertyPublication.id, pub.id))
      .returning();
    await writeAudit(tx, ctx, {
      action: "publication.status",
      entityType: "property",
      entityId: pub.propertyId,
      before: { status: pub.status, portal: pub.portal },
      after: { status: input.status, portal: pub.portal },
    });
    return after;
  });
}

export async function listPublications(
  db: DbOrTx,
  ctx: RequestContext,
  opts: {
    portal?: Portal;
    status?: PublicationStatus | "alerts" | "all";
    propertyId?: string;
    today: string;
  },
) {
  requirePermission(ctx, "publication.read");
  const rows = await db
    .select({
      pub: propertyPublication,
      propertyCode: property.code,
      propertyTitle: property.title,
      propertyType: property.type,
      propertyStatus: property.status,
      propertyAddress: property.address,
      zone: sql<string | null>`nullif(concat_ws(', ', ${neighborhood.name}, ${locality.name}), '')`,
      agentName: user.name,
    })
    .from(propertyPublication)
    .innerJoin(property, eq(property.id, propertyPublication.propertyId))
    .leftJoin(neighborhood, eq(neighborhood.id, property.neighborhoodId))
    .leftJoin(locality, eq(locality.id, property.localityId))
    .leftJoin(user, eq(user.id, property.assignedUserId))
    .where(
      and(
        eq(propertyPublication.organizationId, ctx.organizationId),
        isNull(property.deletedAt),
        opts.portal ? eq(propertyPublication.portal, opts.portal) : undefined,
        opts.propertyId
          ? eq(propertyPublication.propertyId, parseInput(uuidSchema, opts.propertyId))
          : undefined,
        opts.status && opts.status !== "all" && opts.status !== "alerts"
          ? eq(propertyPublication.status, opts.status)
          : undefined,
      ),
    )
    .orderBy(
      sql`case ${propertyPublication.status} when 'published' then 0 when 'paused' then 1 when 'expired' then 2 else 3 end`,
      asc(propertyPublication.portal),
      desc(propertyPublication.publishedAt),
    )
    .limit(500);
  let items = rows.map((r) => ({
    ...r.pub,
    propertyCode: r.propertyCode,
    propertyLabel: propertyDisplayTitle({
      title: r.propertyTitle,
      type: r.propertyType,
      code: r.propertyCode,
    }),
    propertyStatus: r.propertyStatus,
    propertyAddress: r.propertyAddress,
    zone: r.zone,
    agentName: r.agentName,
    alerts: publicationAlerts(r.pub, r.propertyStatus, opts.today),
  }));
  if (opts.status === "alerts") items = items.filter((i) => i.alerts.length > 0);

  const accounts = await db
    .select()
    .from(portalAccount)
    .where(eq(portalAccount.organizationId, ctx.organizationId));
  const usage = await db
    .select({
      portal: propertyPublication.portal,
      level: propertyPublication.level,
      n: sql<number>`count(*)::int`,
    })
    .from(propertyPublication)
    .where(
      and(
        eq(propertyPublication.organizationId, ctx.organizationId),
        eq(propertyPublication.status, "published"),
      ),
    )
    .groupBy(propertyPublication.portal, propertyPublication.level);
  return {
    items,
    portals: PORTALS.map((portal) => {
      const a = accounts.find((x) => x.portal === portal);
      const used = Object.fromEntries(
        usage.filter((u) => u.portal === portal).map((u) => [u.level, u.n]),
      ) as Partial<Record<AdLevel, number>>;
      return {
        portal,
        enabled: a?.enabled ?? false,
        quotas: a?.quotas ?? {},
        used,
        total: Object.values(used).reduce((x, y) => x + (y ?? 0), 0),
      };
    }),
    canManage: hasPermission(ctx, "publication.manage"),
  };
}

/** Avisos publicados para el feed XML de una cuenta (sin sesión: autentica el token). */
export async function feedListings(db: DbOrTx, token: string) {
  if (!/^[0-9a-f]{48}$/.test(token)) return null;
  const [account] = await db.select().from(portalAccount).where(eq(portalAccount.feedToken, token));
  if (!account?.enabled) return null;
  const rows = await db
    .select({
      pub: propertyPublication,
      p: property,
      localityName: locality.name,
      neighborhoodName: neighborhood.name,
    })
    .from(propertyPublication)
    .innerJoin(property, eq(property.id, propertyPublication.propertyId))
    .leftJoin(locality, eq(locality.id, property.localityId))
    .leftJoin(neighborhood, eq(neighborhood.id, property.neighborhoodId))
    .where(
      and(
        eq(propertyPublication.organizationId, account.organizationId),
        eq(propertyPublication.portal, account.portal),
        eq(propertyPublication.status, "published"),
        inArray(property.status, [...OFFERABLE]),
        isNull(property.deletedAt),
      ),
    )
    .orderBy(asc(property.code));
  const ids = rows.map((r) => r.p.id);
  const [prices, photos] = ids.length
    ? await Promise.all([
        db.select().from(propertyPrice).where(inArray(propertyPrice.propertyId, ids)),
        db
          .select({
            id: propertyMedia.id,
            propertyId: propertyMedia.propertyId,
            isCover: propertyMedia.isCover,
            position: propertyMedia.position,
          })
          .from(propertyMedia)
          .where(and(inArray(propertyMedia.propertyId, ids), eq(propertyMedia.kind, "photo")))
          .orderBy(desc(propertyMedia.isCover), asc(propertyMedia.position)),
      ])
    : [[], []];
  return {
    account,
    listings: rows.map((r) => ({
      ...r,
      prices: prices.filter((x) => x.propertyId === r.p.id && x.listMinor !== null),
      photoIds: photos.filter((x) => x.propertyId === r.p.id).map((x) => x.id),
    })),
  };
}

/** ¿La foto pertenece a un aviso publicado de esta cuenta? (para servirla en el feed). */
export async function feedPhotoAllowed(db: DbOrTx, token: string, mediaId: string): Promise<boolean> {
  const feed = await feedListings(db, token);
  return Boolean(feed?.listings.some((l) => l.photoIds.includes(mediaId)));
}

// ─── Tipo de cambio ─────────────────────────────────────────────────────────

export async function listExchangeRates(db: DbOrTx, ctx: RequestContext, limit = 30) {
  requirePermission(ctx, "integrations.manage");
  const [rows, [settings]] = await Promise.all([
    db
      .select({ r: exchangeRate, by: user.name })
      .from(exchangeRate)
      .leftJoin(user, eq(user.id, exchangeRate.createdById))
      .where(eq(exchangeRate.organizationId, ctx.organizationId))
      .orderBy(desc(exchangeRate.date))
      .limit(limit),
    db.select().from(commissionSettings).where(eq(commissionSettings.organizationId, ctx.organizationId)),
  ]);
  return { items: rows.map((x) => ({ ...x.r, createdByName: x.by })), current: settings?.uyuPerUsd ?? null };
}

/**
 * Guarda el tipo de cambio del día. Si es el más reciente pasa a ser el de referencia del CRM
 * (comisiones en pesos, matching y comparables).
 */
export async function saveExchangeRate(
  db: Db,
  ctx: RequestContext,
  rawInput: unknown,
  source: "manual" | "bcu" = "manual",
) {
  requirePermission(ctx, "integrations.manage");
  const input = parseInput(exchangeRateSchema, rawInput);
  if (Number(input.rate) <= 0) throw new ValidationError("Tipo de cambio inválido", { rate: ["Inválido"] });
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(exchangeRate)
      .values({
        organizationId: ctx.organizationId,
        date: input.date,
        uyuPerUsd: input.rate,
        source,
        createdById: ctx.userId,
      })
      .onConflictDoUpdate({
        target: [exchangeRate.organizationId, exchangeRate.date],
        set: { uyuPerUsd: input.rate, source, createdById: ctx.userId },
      })
      .returning();
    const [latest] = await tx
      .select({ date: exchangeRate.date, rate: exchangeRate.uyuPerUsd })
      .from(exchangeRate)
      .where(eq(exchangeRate.organizationId, ctx.organizationId))
      .orderBy(desc(exchangeRate.date))
      .limit(1);
    if (latest?.date === input.date)
      await tx
        .insert(commissionSettings)
        .values({ organizationId: ctx.organizationId, uyuPerUsd: input.rate })
        .onConflictDoUpdate({ target: commissionSettings.organizationId, set: { uyuPerUsd: input.rate } });
    await writeAudit(tx, ctx, {
      action: "exchange_rate.save",
      entityType: "organization",
      entityId: ctx.organizationId,
      after: { date: input.date, rate: input.rate, source },
    });
    return row;
  });
}

/** Foto de un aviso publicado, para el feed (autentica el token, sin sesión). */
export async function readFeedMedia(
  db: DbOrTx,
  storage: { get(key: string): Promise<Buffer> },
  token: string,
  mediaId: string,
  size: "full" | "thumb",
): Promise<{ body: Buffer; mimeType: string } | null> {
  if (!uuidSchema.safeParse(mediaId).success) return null;
  if (!(await feedPhotoAllowed(db, token, mediaId))) return null;
  const [m] = await db.select().from(propertyMedia).where(eq(propertyMedia.id, mediaId));
  const key = size === "thumb" ? (m?.thumbKey ?? m?.storageKey) : m?.storageKey;
  if (!m || !key) return null;
  return { body: await storage.get(key), mimeType: m.mimeType ?? "image/webp" };
}
