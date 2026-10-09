import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import {
  locality,
  neighborhood,
  portalAccount,
  property,
  propertyMedia,
  propertyPrice,
  propertyPublication,
  type Db,
  type DbOrTx,
} from "@crm/db";
import {
  ML_LISTING_TYPES,
  PORTAL_CREDENTIAL_FIELDS,
  maskSecret,
  type AdLevel,
  type Portal,
} from "@crm/shared/publications";
import { PROPERTY_TYPE_LABELS, type PropertyType } from "@crm/shared/crm";
import { portalCredentialsSchema } from "@crm/shared/validation/publications";
import { writeAudit } from "../audit";
import { requirePermission, type RequestContext } from "../context";
import { decryptField, encryptField } from "../crypto";
import { ConflictError, NotFoundError, parseInput } from "../errors";

const ML_API = "https://api.mercadolibre.com";
const ML_AUTH = "https://auth.mercadolibre.com.uy/authorization";

export function encryptionConfigured(): boolean {
  return Boolean(process.env.FIELD_ENCRYPTION_KEY);
}

/** URL pública del CRM (para las fotos que descarga el portal y el retorno de OAuth). */
export function appBaseUrl(): string | null {
  const v = (u?: string) => (u ? (u.startsWith("http") ? u : `https://${u}`) : null);
  return v(process.env.BETTER_AUTH_URL) ?? v(process.env.VERCEL_PROJECT_PRODUCTION_URL) ?? null;
}

async function loadAccount(db: DbOrTx, organizationId: string, portal: Portal) {
  const [a] = await db
    .select()
    .from(portalAccount)
    .where(and(eq(portalAccount.organizationId, organizationId), eq(portalAccount.portal, portal)));
  if (!a) throw new NotFoundError("Portal");
  return a;
}

function readCredentials(a: { credentialsEncrypted: string | null }): Record<string, string> {
  if (!a.credentialsEncrypted) return {};
  try {
    return JSON.parse(decryptField(a.credentialsEncrypted)) as Record<string, string>;
  } catch {
    throw new ConflictError("No se pudieron leer las credenciales guardadas (¿cambió FIELD_ENCRYPTION_KEY?)");
  }
}

/** Guarda las credenciales de un portal (cifradas). Un secreto vacío conserva el anterior. */
export async function savePortalCredentials(db: Db, ctx: RequestContext, rawInput: unknown) {
  requirePermission(ctx, "integrations.manage");
  const input = parseInput(portalCredentialsSchema, rawInput);
  if (!encryptionConfigured())
    throw new ConflictError("Falta configurar FIELD_ENCRYPTION_KEY en el servidor para guardar credenciales");
  return db.transaction(async (tx) => {
    const a = await loadAccount(tx, ctx.organizationId, input.portal);
    const current = readCredentials(a);
    const next: Record<string, string> = {};
    const hints: Record<string, string> = {};
    for (const f of PORTAL_CREDENTIAL_FIELDS[input.portal]) {
      const v = input.values[f.key]?.trim() ?? "";
      const value = f.secret && !v ? (current[f.key] ?? "") : v;
      if (!value) continue;
      next[f.key] = value;
      hints[f.key] = f.secret ? maskSecret(value) : value;
    }
    // Si cambia la aplicación de Mercado Libre, la conexión anterior deja de valer.
    const appChanged = input.portal === "mercadolibre" && current.appId !== next.appId;
    await tx
      .update(portalAccount)
      .set({
        credentialsEncrypted: Object.keys(next).length ? encryptField(JSON.stringify(next)) : null,
        credentialHints: hints,
        ...(appChanged ? { tokensEncrypted: null, connection: null } : {}),
        lastError: null,
      })
      .where(eq(portalAccount.id, a.id));
    await writeAudit(tx, ctx, {
      action: "portal.credentials_update",
      entityType: "portal_account",
      entityId: a.id,
      // Solo qué campos cambiaron, nunca los valores.
      after: { fields: Object.keys(next) },
    });
    return { hints };
  });
}

export async function clearPortalCredentials(db: Db, ctx: RequestContext, portal: Portal) {
  requirePermission(ctx, "integrations.manage");
  return db.transaction(async (tx) => {
    const a = await loadAccount(tx, ctx.organizationId, portal);
    await tx
      .update(portalAccount)
      .set({ credentialsEncrypted: null, credentialHints: {}, tokensEncrypted: null, connection: null })
      .where(eq(portalAccount.id, a.id));
    await writeAudit(tx, ctx, {
      action: "portal.credentials_clear",
      entityType: "portal_account",
      entityId: a.id,
    });
  });
}

// ─── Mercado Libre (OAuth + API) ────────────────────────────────────────────

interface MlTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  userId: string;
}

export class PortalApiError extends ConflictError {}

async function mlError(res: Response): Promise<PortalApiError> {
  const body = (await res.json().catch(() => ({}))) as {
    message?: string;
    error?: string;
    cause?: { message?: string }[];
  };
  const causes = (body.cause ?? []).map((c) => c.message).filter(Boolean);
  return new PortalApiError(
    `Mercado Libre: ${[body.message ?? body.error ?? `HTTP ${res.status}`, ...causes].join(" · ")}`,
  );
}

export function mlRedirectUri(base: string): string {
  return `${base.replace(/\/$/, "")}/api/integrations/mercadolibre/callback`;
}

/** URL para "Conectar con Mercado Libre" (con PKCE; el estado va cifrado). */
export async function mercadoLibreAuthorizeUrl(db: DbOrTx, ctx: RequestContext, base: string) {
  requirePermission(ctx, "integrations.manage");
  const a = await loadAccount(db, ctx.organizationId, "mercadolibre");
  const creds = readCredentials(a);
  if (!creds.appId || !creds.clientSecret)
    throw new ConflictError("Cargá primero el App ID y la clave secreta de tu aplicación de Mercado Libre");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = encryptField(
    JSON.stringify({ o: ctx.organizationId, u: ctx.userId, v: verifier, t: Date.now() }),
  );
  const q = new URLSearchParams({
    response_type: "code",
    client_id: creds.appId,
    redirect_uri: mlRedirectUri(base),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `${ML_AUTH}?${q.toString()}`;
}

/** Retorno de OAuth: canjea el código por tokens y los guarda cifrados. */
export async function completeMercadoLibreConnection(
  db: Db,
  ctx: RequestContext,
  input: { code: string; state: string; base: string },
) {
  requirePermission(ctx, "integrations.manage");
  let st: { o: string; u: string; v: string; t: number };
  try {
    st = JSON.parse(decryptField(input.state)) as typeof st;
  } catch {
    throw new ConflictError("La conexión no es válida. Probá de nuevo desde Integraciones.");
  }
  if (st.o !== ctx.organizationId || st.u !== ctx.userId || Date.now() - st.t > 15 * 60_000)
    throw new ConflictError("La conexión venció. Probá de nuevo desde Integraciones.");
  const a = await loadAccount(db, ctx.organizationId, "mercadolibre");
  const creds = readCredentials(a);
  const res = await fetch(`${ML_API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: creds.appId ?? "",
      client_secret: creds.clientSecret ?? "",
      code: input.code,
      redirect_uri: mlRedirectUri(input.base),
      code_verifier: st.v,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw await mlError(res);
  const t = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    user_id: number;
  };
  const tokens: MlTokens = {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: new Date(Date.now() + t.expires_in * 1000).toISOString(),
    userId: String(t.user_id),
  };
  const me = await fetch(`${ML_API}/users/me`, {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  const profile = me.ok ? ((await me.json()) as { nickname?: string }) : {};
  await db
    .update(portalAccount)
    .set({
      tokensEncrypted: encryptField(JSON.stringify(tokens)),
      connection: {
        userId: tokens.userId,
        nickname: profile.nickname,
        connectedAt: new Date().toISOString(),
        expiresAt: tokens.expiresAt,
      },
      lastError: null,
    })
    .where(eq(portalAccount.id, a.id));
  await writeAudit(db, ctx, {
    action: "portal.connect",
    entityType: "portal_account",
    entityId: a.id,
    after: { portal: "mercadolibre", user: profile.nickname ?? tokens.userId },
  });
  return { nickname: profile.nickname ?? tokens.userId };
}

export async function disconnectPortal(db: Db, ctx: RequestContext, portal: Portal) {
  requirePermission(ctx, "integrations.manage");
  const a = await loadAccount(db, ctx.organizationId, portal);
  await db
    .update(portalAccount)
    .set({ tokensEncrypted: null, connection: null })
    .where(eq(portalAccount.id, a.id));
  await writeAudit(db, ctx, { action: "portal.disconnect", entityType: "portal_account", entityId: a.id });
}

/** Token vigente (se renueva solo; el refresh token de ML es de un solo uso, así que se bloquea la fila). */
async function mlAccessToken(
  db: Db,
  organizationId: string,
): Promise<{ token: string; feedToken: string } | null> {
  return db.transaction(async (tx) => {
    const [a] = await tx
      .select()
      .from(portalAccount)
      .where(and(eq(portalAccount.organizationId, organizationId), eq(portalAccount.portal, "mercadolibre")))
      .for("update");
    if (!a?.tokensEncrypted) return null;
    const tokens = JSON.parse(decryptField(a.tokensEncrypted)) as MlTokens;
    if (Date.parse(tokens.expiresAt) - Date.now() > 5 * 60_000)
      return { token: tokens.accessToken, feedToken: a.feedToken };
    const creds = readCredentials(a);
    const res = await fetch(`${ML_API}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: creds.appId ?? "",
        client_secret: creds.clientSecret ?? "",
        refresh_token: tokens.refreshToken,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const err = await mlError(res);
      await tx
        .update(portalAccount)
        .set({ lastError: `${err.message}. Volvé a conectar la cuenta.` })
        .where(eq(portalAccount.id, a.id));
      return null;
    }
    const t = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
    const next: MlTokens = {
      ...tokens,
      accessToken: t.access_token,
      refreshToken: t.refresh_token,
      expiresAt: new Date(Date.now() + t.expires_in * 1000).toISOString(),
    };
    await tx
      .update(portalAccount)
      .set({
        tokensEncrypted: encryptField(JSON.stringify(next)),
        connection: { ...(a.connection ?? {}), expiresAt: next.expiresAt },
      })
      .where(eq(portalAccount.id, a.id));
    return { token: next.accessToken, feedToken: a.feedToken };
  });
}

async function mlFetch(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${ML_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...init.headers,
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw await mlError(res);
  return res.json() as Promise<Record<string, unknown>>;
}

/** Prueba la conexión del portal y devuelve un texto para mostrar. */
export async function testPortalConnection(db: Db, ctx: RequestContext, portal: Portal) {
  requirePermission(ctx, "integrations.manage");
  const a = await loadAccount(db, ctx.organizationId, portal);
  if (portal === "mercadolibre") {
    const t = await mlAccessToken(db, ctx.organizationId);
    if (!t) throw new ConflictError("La cuenta de Mercado Libre no está conectada");
    const me = await mlFetch(t.token, "/users/me");
    return `Conectado como ${String(me.nickname ?? me.id)}`;
  }
  const creds = readCredentials(a);
  if (!Object.keys(creds).length) throw new ConflictError("No hay credenciales cargadas");
  if (portal === "other" && creds.apiUrl) {
    const res = await fetch(creds.apiUrl, {
      headers: creds.apiKey ? { Authorization: `Bearer ${creds.apiKey}` } : {},
      signal: AbortSignal.timeout(10_000),
    });
    return `La API respondió ${res.status}`;
  }
  return "Credenciales guardadas. La publicación automática se activa cuando el portal entregue la documentación de su API; mientras tanto se usa el listado XML.";
}

// ─── Publicación automática en Mercado Libre ───────────────────────────────

const ML_PROPERTY_TYPE: Partial<Record<PropertyType, string>> = {
  apartment: "Apartamento",
  house: "Casa",
  land: "Terreno",
  office: "Oficina",
  commercial: "Local",
  warehouse: "Galpón",
  farm: "Chacra",
  garage: "Cochera",
  ph: "PH",
};

/** Arma el aviso para la API de Mercado Libre a partir de la propiedad. */
async function buildMlItem(db: DbOrTx, publicationId: string, base: string, feedToken: string) {
  const [r] = await db
    .select({ pub: propertyPublication, p: property, loc: locality.name, nb: neighborhood.name })
    .from(propertyPublication)
    .innerJoin(property, eq(property.id, propertyPublication.propertyId))
    .leftJoin(locality, eq(locality.id, property.localityId))
    .leftJoin(neighborhood, eq(neighborhood.id, property.neighborhoodId))
    .where(eq(propertyPublication.id, publicationId));
  if (!r) throw new NotFoundError("Publicación");
  const prices = await db.select().from(propertyPrice).where(eq(propertyPrice.propertyId, r.p.id));
  const price = prices.find((x) => x.operation === "sale" && x.listMinor) ?? prices.find((x) => x.listMinor);
  if (!price?.listMinor) throw new ConflictError("La propiedad no tiene precio publicado");
  const photos = await db
    .select({ id: propertyMedia.id })
    .from(propertyMedia)
    .where(and(eq(propertyMedia.propertyId, r.p.id), eq(propertyMedia.kind, "photo")))
    .orderBy(desc(propertyMedia.isCover), asc(propertyMedia.position))
    .limit(12);
  const typeLabel =
    ML_PROPERTY_TYPE[r.p.type as PropertyType] ?? PROPERTY_TYPE_LABELS[r.p.type as PropertyType];
  const operation =
    price.operation === "sale" ? "Venta" : price.operation === "rent" ? "Alquiler" : "Alquiler temporal";
  const attr = (id: string, value: string | number | null | undefined) =>
    value === null || value === undefined || value === "" ? [] : [{ id, value_name: String(value) }];
  const title = (r.p.title ?? `${typeLabel} en ${operation.toLowerCase()} en ${r.nb ?? r.loc ?? ""}`).slice(
    0,
    60,
  );
  return {
    title,
    query: `${typeLabel} ${operation} ${r.nb ?? r.loc ?? ""}`.trim(),
    body: {
      title,
      price: Number(price.listMinor) / 100,
      currency_id: price.currency,
      available_quantity: 1,
      buying_mode: "classified",
      listing_type_id: ML_LISTING_TYPES[r.pub.level as AdLevel] ?? "silver",
      condition: "not_specified",
      pictures: photos.map((m) => ({ source: `${base}/api/feeds/${feedToken}/media/${m.id}?size=full` })),
      attributes: [
        ...attr("OPERATION", operation),
        ...attr("PROPERTY_TYPE", typeLabel),
        ...attr("COVERED_AREA", r.p.builtArea ? `${Number(r.p.builtArea)} m²` : null),
        ...attr("TOTAL_AREA", r.p.totalArea ? `${Number(r.p.totalArea)} m²` : null),
        ...attr("BEDROOMS", r.p.bedrooms),
        ...attr("FULL_BATHROOMS", r.p.bathrooms),
        ...attr("PARKING_LOTS", r.p.garages),
      ],
      location: {
        city: { name: r.loc ?? "" },
        neighborhood: { name: r.nb ?? "" },
        ...(r.p.latitude && r.p.longitude
          ? {
              latitude: Number(Number(r.p.latitude).toFixed(3)),
              longitude: Number(Number(r.p.longitude).toFixed(3)),
            }
          : {}),
      },
      description: { plain_text: r.p.description ?? title },
    },
    pub: r.pub,
    priceValue: Number(price.listMinor) / 100,
  };
}

const ML_STATUS: Record<string, "active" | "paused" | "closed"> = {
  published: "active",
  paused: "paused",
  expired: "closed",
  removed: "closed",
};

/**
 * Lleva una publicación a Mercado Libre: la crea si no tiene id externo o actualiza precio y
 * estado. Nunca lanza: deja el error en la publicación para mostrarlo.
 */
export async function pushPublication(
  db: Db,
  organizationId: string,
  publicationId: string,
): Promise<string | null> {
  const [pub] = await db
    .select()
    .from(propertyPublication)
    .where(
      and(eq(propertyPublication.id, publicationId), eq(propertyPublication.organizationId, organizationId)),
    );
  if (!pub || pub.portal !== "mercadolibre") return null;
  const base = appBaseUrl();
  try {
    const t = await mlAccessToken(db, organizationId);
    if (!t) return null; // sin conexión: queda como aviso manual
    if (!base) throw new ConflictError("Falta BETTER_AUTH_URL para que Mercado Libre descargue las fotos");
    const item = await buildMlItem(db, pub.id, base, t.feedToken);
    let externalId = pub.externalId;
    let url = pub.url;
    if (!externalId) {
      if (pub.status !== "published") return null;
      const cat = (await fetch(
        `${ML_API}/sites/MLU/domain_discovery/search?limit=1&q=${encodeURIComponent(item.query)}`,
        { signal: AbortSignal.timeout(15_000) },
      )
        .then((r) => r.json())
        .catch(() => [])) as { category_id?: string }[];
      if (!cat[0]?.category_id)
        throw new ConflictError("Mercado Libre no sugirió una categoría para el aviso");
      const created = await mlFetch(t.token, "/items", {
        method: "POST",
        body: JSON.stringify({ ...item.body, category_id: cat[0].category_id }),
      });
      externalId = String(created.id);
      url = String(created.permalink ?? "");
    } else {
      await mlFetch(t.token, `/items/${externalId}`, {
        method: "PUT",
        body: JSON.stringify(
          ML_STATUS[pub.status] === "active"
            ? { price: item.priceValue, status: "active" }
            : { status: ML_STATUS[pub.status] },
        ),
      });
    }
    const now = new Date();
    await db
      .update(propertyPublication)
      .set({ externalId, url, syncedAt: now, updatedAt: now, syncError: null })
      .where(eq(propertyPublication.id, pub.id));
    return null;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const now = new Date();
    await db
      .update(propertyPublication)
      .set({ syncError: message.slice(0, 500), syncedAt: now, updatedAt: now })
      .where(eq(propertyPublication.id, pub.id));
    return message;
  }
}

/**
 * Sincroniza en segundo plano lo que cambió (por ejemplo, la propiedad se reservó y el aviso se
 * pausó) y trae las visitas de cada aviso de Mercado Libre.
 */
export async function syncPortalPublications(db: Db, organizationId?: string) {
  const accounts = await db
    .select({ organizationId: portalAccount.organizationId })
    .from(portalAccount)
    .where(
      and(
        eq(portalAccount.portal, "mercadolibre"),
        isNotNull(portalAccount.tokensEncrypted),
        organizationId ? eq(portalAccount.organizationId, organizationId) : undefined,
      ),
    );
  let pushed = 0;
  for (const acc of accounts) {
    const pending = await db
      .select({ id: propertyPublication.id })
      .from(propertyPublication)
      .where(
        and(
          eq(propertyPublication.organizationId, acc.organizationId),
          eq(propertyPublication.portal, "mercadolibre"),
          or(
            and(
              isNull(propertyPublication.externalId),
              eq(propertyPublication.status, "published"),
              isNull(propertyPublication.syncError),
            ),
            and(
              isNotNull(propertyPublication.externalId),
              sql`${propertyPublication.updatedAt} > coalesce(${propertyPublication.syncedAt}, 'epoch')`,
            ),
          ),
        ),
      )
      .limit(50);
    for (const p of pending) {
      await pushPublication(db, acc.organizationId, p.id);
      pushed++;
    }
    // Visitas (API pública de Mercado Libre).
    const live = await db
      .select({ id: propertyPublication.id, ext: propertyPublication.externalId })
      .from(propertyPublication)
      .where(
        and(
          eq(propertyPublication.organizationId, acc.organizationId),
          eq(propertyPublication.portal, "mercadolibre"),
          eq(propertyPublication.status, "published"),
          isNotNull(propertyPublication.externalId),
        ),
      )
      .limit(50);
    if (live.length) {
      const ids = live
        .map((l) => l.ext)
        .filter(Boolean)
        .join(",");
      const visits = (await fetch(`${ML_API}/visits/items?ids=${ids}`, {
        signal: AbortSignal.timeout(15_000),
      })
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({}))) as Record<string, number>;
      for (const l of live)
        if (l.ext && typeof visits[l.ext] === "number")
          await db
            .update(propertyPublication)
            .set({ views: visits[l.ext], syncedAt: sql`now()`, updatedAt: sql`now()` })
            .where(eq(propertyPublication.id, l.id));
    }
    await db
      .update(portalAccount)
      .set({ lastSyncAt: new Date() })
      .where(
        and(eq(portalAccount.organizationId, acc.organizationId), eq(portalAccount.portal, "mercadolibre")),
      );
  }
  return { pushed };
}

export async function syncPortalsNow(db: Db, ctx: RequestContext) {
  requirePermission(ctx, "integrations.manage");
  return syncPortalPublications(db, ctx.organizationId);
}

/** Ids de publicaciones (para que la web empuje a Mercado Libre tras publicar o cambiar estado). */
export async function mercadoLibrePublicationIds(db: DbOrTx, organizationId: string, ids: string[]) {
  if (!ids.length) return [];
  const rows = await db
    .select({ id: propertyPublication.id })
    .from(propertyPublication)
    .where(
      and(
        eq(propertyPublication.organizationId, organizationId),
        inArray(propertyPublication.id, ids),
        eq(propertyPublication.portal, "mercadolibre"),
      ),
    );
  return rows.map((r) => r.id);
}
