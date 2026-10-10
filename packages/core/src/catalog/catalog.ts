import { and, asc, eq } from "drizzle-orm";
import { commissionSettings, organization, portalAccount, type Db, type DbOrTx } from "@crm/db";
import { PROPERTY_FEATURE_LABELS, PROPERTY_TYPE_LABELS, type PropertyType } from "@crm/shared/crm";
import { ORIENTATION_LABELS, PROPERTY_CONDITION_LABELS, type Orientation, type PropertyCondition } from "@crm/shared";
import { formatMoney } from "@crm/shared/money";
import { z } from "zod";
import { ingestInquiry } from "../communications/inbox";
import { orgLogoUrl } from "../context";
import { parseInput } from "../errors";
import { feedListings, readFeedMedia } from "../properties/publications";

/**
 * Catálogo público del sitio web de la inmobiliaria. Muestra solo lo publicado en el portal
 * «Sitio web propio»: sin dirección exacta, padrón ni datos internos.
 */

export interface SiteOrganization {
  id: string;
  name: string;
  logoUrl: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  website: string | null;
}

/**
 * Inmobiliaria dueña del sitio: SITE_ORG_SLUG si está configurada; si no, la única organización
 * real; en desarrollo (solo hay DEMO), la de demostración.
 */
export async function siteOrganization(db: DbOrTx): Promise<SiteOrganization | null> {
  const slug = process.env.SITE_ORG_SLUG?.trim();
  const rows = await db
    .select()
    .from(organization)
    .where(slug ? eq(organization.slug, slug) : undefined)
    .orderBy(asc(organization.isDemo), asc(organization.createdAt))
    .limit(5);
  const real = rows.filter((o) => !o.isDemo);
  const o = slug ? rows[0] : real.length === 1 ? real[0] : real.length === 0 ? rows[0] : undefined;
  if (!o) return null;
  return {
    id: o.id,
    name: o.name,
    logoUrl: orgLogoUrl(o.id, o.logoKey, o.logoUpdatedAt),
    phone: o.phone,
    email: o.email,
    address: o.address,
    website: o.website,
  };
}

async function websiteFeed(db: DbOrTx, organizationId: string) {
  const [acc] = await db
    .select({ token: portalAccount.feedToken })
    .from(portalAccount)
    .where(and(eq(portalAccount.organizationId, organizationId), eq(portalAccount.portal, "website")));
  if (!acc?.token) return null;
  const feed = await feedListings(db, acc.token);
  return feed ? { token: acc.token, listings: feed.listings } : null;
}

type Listing = NonNullable<Awaited<ReturnType<typeof websiteFeed>>>["listings"][number];

export interface CatalogPrice {
  operation: "sale" | "rent";
  label: string;
  amount: number;
  currency: "UYU" | "USD";
}

export interface CatalogItem {
  code: string;
  title: string;
  type: PropertyType;
  typeLabel: string;
  zone: string;
  localityName: string | null;
  neighborhoodName: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  garages: number | null;
  builtArea: number | null;
  totalArea: number | null;
  prices: CatalogPrice[];
  photoIds: string[];
  publishedAt: Date | null;
}

function toItem(l: Listing): CatalogItem {
  const prices = l.prices
    .filter((x) => x.listMinor !== null)
    .map((x) => ({
      operation: x.operation as "sale" | "rent",
      currency: x.currency,
      amount: Number(x.listMinor) / 100,
      label: formatMoney({ amountMinor: x.listMinor ?? 0n, currency: x.currency }, { showDecimals: "never" }),
    }))
    .sort((a, b) => (a.operation === b.operation ? 0 : a.operation === "sale" ? -1 : 1));
  return {
    code: l.p.code,
    title: l.p.title?.trim() || `${PROPERTY_TYPE_LABELS[l.p.type as PropertyType]} ${l.p.code}`,
    type: l.p.type as PropertyType,
    typeLabel: PROPERTY_TYPE_LABELS[l.p.type as PropertyType],
    zone: [l.neighborhoodName, l.localityName].filter(Boolean).join(", "),
    localityName: l.localityName,
    neighborhoodName: l.neighborhoodName,
    bedrooms: l.p.bedrooms,
    bathrooms: l.p.bathrooms,
    garages: l.p.garages,
    builtArea: l.p.builtArea ? Number(l.p.builtArea) : null,
    totalArea: l.p.totalArea ? Number(l.p.totalArea) : null,
    prices,
    photoIds: l.photoIds,
    publishedAt: l.pub.publishedAt ?? l.p.publishedAt ?? null,
  };
}

export const catalogFilterSchema = z.object({
  operacion: z.enum(["venta", "alquiler"]).optional().catch(undefined),
  tipo: z.string().max(40).optional().catch(undefined),
  zona: z.string().max(80).optional().catch(undefined),
  dormitorios: z.coerce.number().int().min(0).max(10).optional().catch(undefined),
  precioMax: z.coerce.number().positive().max(1e10).optional().catch(undefined),
  moneda: z.enum(["USD", "UYU"]).optional().catch(undefined),
  orden: z.enum(["recientes", "precio-asc", "precio-desc"]).optional().catch(undefined),
});
export type CatalogFilters = z.infer<typeof catalogFilterSchema>;

export async function listCatalog(db: DbOrTx, organizationId: string, rawFilters: unknown) {
  const f = catalogFilterSchema.parse(rawFilters ?? {});
  const feed = await websiteFeed(db, organizationId);
  const all = (feed?.listings ?? []).map(toItem);
  const [settings] = await db
    .select({ rate: commissionSettings.uyuPerUsd })
    .from(commissionSettings)
    .where(eq(commissionSettings.organizationId, organizationId));
  const rate = settings?.rate ? Number(settings.rate) : 40;
  const op = f.operacion === "venta" ? "sale" : f.operacion === "alquiler" ? "rent" : undefined;
  const priceFor = (i: CatalogItem) => i.prices.find((p) => !op || p.operation === op) ?? null;
  const inCurrency = (p: CatalogPrice, cur: "USD" | "UYU") =>
    p.currency === cur ? p.amount : cur === "USD" ? p.amount / rate : p.amount * rate;

  let items = all.filter((i) => {
    if (op && !i.prices.some((p) => p.operation === op)) return false;
    if (f.tipo && i.type !== f.tipo) return false;
    if (f.zona && i.neighborhoodName !== f.zona && i.localityName !== f.zona) return false;
    if (f.dormitorios !== undefined && (i.bedrooms ?? 0) < f.dormitorios) return false;
    if (f.precioMax) {
      const p = priceFor(i);
      const cur = f.moneda ?? (op === "rent" ? "UYU" : "USD");
      if (!p || inCurrency(p, cur) > f.precioMax) return false;
    }
    return true;
  });
  const sortValue = (i: CatalogItem) => {
    const p = priceFor(i);
    return p ? inCurrency(p, "USD") : Number.POSITIVE_INFINITY;
  };
  if (f.orden === "precio-asc") items = items.sort((a, b) => sortValue(a) - sortValue(b));
  else if (f.orden === "precio-desc") items = items.sort((a, b) => sortValue(b) - sortValue(a));
  else items = items.sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));

  const types = [...new Set(all.map((i) => i.type))].map((t) => ({ value: t, label: PROPERTY_TYPE_LABELS[t] }));
  const zones = [...new Set(all.flatMap((i) => [i.neighborhoodName, i.localityName]).filter(Boolean))]
    .map(String)
    .sort((a, b) => a.localeCompare(b, "es"));
  return { items, total: all.length, filters: f, options: { types, zones } };
}

export interface CatalogDetail extends CatalogItem {
  description: string | null;
  features: string[];
  suites: number | null;
  floor: string | null;
  yearBuilt: number | null;
  orientation: string | null;
  condition: string | null;
  petsAllowed: boolean;
  furnished: boolean;
  /** Ubicación aproximada (redondeada a ~200 m) para no mostrar la dirección exacta. */
  approxLocation: { lat: number; lng: number } | null;
}

export async function getCatalogProperty(
  db: DbOrTx,
  organizationId: string,
  code: string,
): Promise<{ item: CatalogDetail; related: CatalogItem[] } | null> {
  if (!/^[A-Z]{2,6}-\d{1,9}$/.test(code)) return null;
  const feed = await websiteFeed(db, organizationId);
  const l = feed?.listings.find((x) => x.p.code === code);
  if (!feed || !l) return null;
  const base = toItem(l);
  const round = (v: string | null) => (v === null ? null : Math.round(Number(v) * 500) / 500);
  const lat = round(l.p.latitude);
  const lng = round(l.p.longitude);
  const item: CatalogDetail = {
    ...base,
    description: l.p.description,
    features: (l.p.features ?? []).map((f) => (PROPERTY_FEATURE_LABELS as Record<string, string>)[f] ?? f),
    suites: l.p.suites,
    floor: l.p.floor,
    yearBuilt: l.p.yearBuilt,
    orientation: l.p.orientation ? ORIENTATION_LABELS[l.p.orientation as Orientation] : null,
    condition: l.p.condition ? PROPERTY_CONDITION_LABELS[l.p.condition as PropertyCondition] : null,
    petsAllowed: l.p.petsAllowed,
    furnished: l.p.furnished,
    approxLocation: lat !== null && lng !== null ? { lat, lng } : null,
  };
  const related = feed.listings
    .filter((x) => x.p.code !== code)
    .map(toItem)
    .filter((x) => x.type === base.type || x.zone === base.zone)
    .slice(0, 3);
  return { item, related };
}

/** Foto de una propiedad publicada en el sitio (solo si pertenece a un aviso activo). */
export async function readCatalogPhoto(
  db: DbOrTx,
  storage: { get(key: string): Promise<Buffer> },
  organizationId: string,
  mediaId: string,
  size: "full" | "thumb",
) {
  const [acc] = await db
    .select({ token: portalAccount.feedToken })
    .from(portalAccount)
    .where(and(eq(portalAccount.organizationId, organizationId), eq(portalAccount.portal, "website")));
  return acc?.token ? readFeedMedia(db, storage, acc.token, mediaId, size) : null;
}

const catalogInquirySchema = z.object({
  name: z.string().trim().min(2, "Escribí tu nombre").max(120),
  phone: z.string().trim().max(40).optional().default(""),
  email: z.string().trim().max(200).optional().default(""),
  message: z.string().trim().max(2000).optional().default(""),
  propertyCode: z.string().trim().max(30).optional().default(""),
  /** Campo trampa: los humanos no lo ven; los bots lo completan. */
  website: z.string().max(200).optional().default(""),
});

/** Consulta desde el sitio web: entra a Comunicaciones → Consultas como canal «web». */
export async function submitCatalogInquiry(db: Db, organizationId: string, rawInput: unknown) {
  const input = parseInput(catalogInquirySchema, rawInput);
  if (input.website) return { ok: true as const, spam: true };
  const message =
    input.message ||
    (input.propertyCode
      ? `Me interesa la propiedad ${input.propertyCode}. Quisiera más información.`
      : "Quisiera que me contacten.");
  await ingestInquiry(db, organizationId, {
    channel: "web",
    name: input.name,
    phone: input.phone || null,
    email: input.email || null,
    message: `${message}\n\n(Enviado desde el sitio web)`,
    propertyCode: input.propertyCode || null,
  });
  return { ok: true as const, spam: false };
}
