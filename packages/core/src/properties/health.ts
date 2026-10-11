import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { neighborhood, property, propertyPrice, propertyPublication, type DbOrTx } from "@crm/db";
import { PORTAL_LABELS, type Portal } from "@crm/shared";
import { hasPermission, type RequestContext } from "../context";
import { propertyDisplayTitle } from "./helpers";

/**
 * «Salud de tus publicaciones»: qué tan completo está cada aviso publicado y cuánto hace que
 * está en el aire, con la sugerencia más útil para mejorarlo.
 */
export interface PublicationHealthItem {
  propertyId: string;
  code: string;
  label: string;
  portals: string[];
  coverMediaId: string | null;
  daysPublished: number;
  quality: number;
  tip: string | null;
  severity: "ok" | "warning" | "danger";
}

const IDEAL_PHOTOS = 12;
const IDEAL_DESCRIPTION = 400;
export const STALE_PUBLICATION_DAYS = 60;

export function scorePublication(p: {
  photos: number;
  descriptionLength: number;
  titleLength: number;
  hasPrice: boolean;
  hasArea: boolean;
  hasRooms: boolean;
  hasZone: boolean;
  isLand: boolean;
  daysPublished: number;
}): { quality: number; tip: string | null } {
  const parts: [number, number, string | null][] = [
    [
      30,
      Math.min(p.photos, IDEAL_PHOTOS) / IDEAL_PHOTOS,
      p.photos < IDEAL_PHOTOS ? `Le faltan fotos (tiene ${p.photos}; ideal ${IDEAL_PHOTOS} o más)` : null,
    ],
    [
      20,
      Math.min(p.descriptionLength, IDEAL_DESCRIPTION) / IDEAL_DESCRIPTION,
      p.descriptionLength < IDEAL_DESCRIPTION
        ? "La descripción es corta: contá más del inmueble y la zona"
        : null,
    ],
    [15, p.hasPrice ? 1 : 0, p.hasPrice ? null : "No tiene precio cargado"],
    [10, p.hasArea ? 1 : 0, p.hasArea ? null : "Faltan los metros cuadrados"],
    [10, p.hasZone ? 1 : 0, p.hasZone ? null : "Falta el barrio"],
    [10, p.titleLength >= 20 ? 1 : 0, p.titleLength >= 20 ? null : "El título es muy corto"],
    [5, p.isLand || p.hasRooms ? 1 : 0, p.isLand || p.hasRooms ? null : "Faltan dormitorios y baños"],
  ];
  const quality = Math.round(parts.reduce((s, [w, v]) => s + w * v, 0));
  // La sugerencia de mayor peso que falte; si está completo, el tiempo publicado.
  const missing = parts
    .filter(([, v, tip]) => v < 1 && tip)
    .sort((a, b) => b[0] * (1 - b[1]) - a[0] * (1 - a[1]));
  const tip =
    missing[0]?.[2] ??
    (p.daysPublished >= STALE_PUBLICATION_DAYS
      ? `Lleva ${p.daysPublished} días publicada: revisá el precio o renová el aviso`
      : null);
  return { quality, tip };
}

export async function publicationHealth(
  db: DbOrTx,
  ctx: RequestContext,
  opts: { limit?: number } = {},
): Promise<PublicationHealthItem[] | null> {
  if (!hasPermission(ctx, "publication.read")) return null;
  const photos = sql<number>`(select count(*)::int from property_media m where m.property_id = ${property.id} and m.kind = 'photo')`;
  const cover = sql<
    string | null
  >`(select m.id from property_media m where m.property_id = ${property.id} and m.kind = 'photo' order by m.is_cover desc, m.position asc limit 1)`;
  const hasPrice = sql<boolean>`exists (select 1 from ${propertyPrice} pp where pp.property_id = ${property.id} and pp.list_minor is not null)`;
  const rows = await db
    .select({
      id: property.id,
      code: property.code,
      title: property.title,
      type: property.type,
      description: property.description,
      builtArea: property.builtArea,
      totalArea: property.totalArea,
      bedrooms: property.bedrooms,
      bathrooms: property.bathrooms,
      neighborhoodName: neighborhood.name,
      assignedUserId: property.assignedUserId,
      portal: propertyPublication.portal,
      publishedAt: propertyPublication.publishedAt,
      photos,
      cover,
      hasPrice,
    })
    .from(propertyPublication)
    .innerJoin(property, eq(property.id, propertyPublication.propertyId))
    .leftJoin(neighborhood, eq(neighborhood.id, property.neighborhoodId))
    .where(
      and(
        eq(propertyPublication.organizationId, ctx.organizationId),
        eq(propertyPublication.status, "published"),
        isNull(property.deletedAt),
      ),
    )
    .orderBy(desc(propertyPublication.publishedAt))
    .limit(400);

  // Agrupa por propiedad (un aviso por portal) y prioriza las del usuario.
  const byProperty = new Map<string, (typeof rows)[number] & { portals: Portal[]; firstPublished: Date }>();
  for (const r of rows) {
    const cur = byProperty.get(r.id);
    if (cur) {
      cur.portals.push(r.portal);
      if (r.publishedAt < cur.firstPublished) cur.firstPublished = r.publishedAt;
    } else byProperty.set(r.id, { ...r, portals: [r.portal], firstPublished: r.publishedAt });
  }
  const all = [...byProperty.values()];
  const mine = all.filter((r) => r.assignedUserId === ctx.userId);
  const pool = mine.length ? mine : all;
  const now = Date.now();

  const items = pool.map((r): PublicationHealthItem => {
    const daysPublished = Math.max(0, Math.floor((now - r.firstPublished.getTime()) / 86_400_000));
    const { quality, tip } = scorePublication({
      photos: Number(r.photos),
      descriptionLength: (r.description ?? "").trim().length,
      titleLength: (r.title ?? "").trim().length,
      hasPrice: Boolean(r.hasPrice),
      hasArea: Boolean(Number(r.builtArea) || Number(r.totalArea)),
      hasRooms: r.bedrooms !== null || r.bathrooms !== null,
      hasZone: Boolean(r.neighborhoodName),
      isLand: r.type === "land",
      daysPublished,
    });
    return {
      propertyId: r.id,
      code: r.code,
      label: propertyDisplayTitle({ title: r.title, type: r.type, code: r.code }),
      portals: r.portals.map((p) => PORTAL_LABELS[p]),
      coverMediaId: r.cover,
      daysPublished,
      quality,
      tip,
      severity: quality < 60 ? "danger" : tip ? "warning" : "ok",
    };
  });
  // Primero las que más necesitan atención.
  const rank = { danger: 0, warning: 1, ok: 2 } as const;
  items.sort(
    (a, b) =>
      rank[a.severity] - rank[b.severity] || a.quality - b.quality || b.daysPublished - a.daysPublished,
  );
  return items.slice(0, opts.limit ?? 6);
}
