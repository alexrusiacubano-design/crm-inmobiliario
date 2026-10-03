import { feedListings } from "@crm/core";
import { getDb } from "@crm/db";

const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const tag = (name: string, value: unknown, attrs = "") =>
  value === null || value === undefined || value === "" ? "" : `<${name}${attrs}>${esc(value)}</${name}>`;
const units = (minor: bigint) =>
  minor % 100n === 0n
    ? (minor / 100n).toString()
    : `${minor / 100n}.${(minor % 100n).toString().padStart(2, "0")}`;

/**
 * Feed XML de avisos publicados en un portal. El portal lo importa periódicamente; el token
 * (Administración → Integraciones) es el secreto. Formato genérico y documentado en cada nodo.
 */
/** Coordenadas aproximadas (~100 m): la ubicación exacta no se publica. */
function approx(v: string | null): string | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(3) : null;
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const feed = await feedListings(getDb(), token);
  if (!feed) return new Response("No encontrado", { status: 404 });
  const origin = new URL(request.url).origin;
  const body = feed.listings
    .map(({ pub, p, prices, photoIds, localityName, neighborhoodName }) =>
      [
        `<listing id="${esc(p.code)}">`,
        tag("reference", p.code),
        tag("externalId", pub.externalId),
        tag("level", pub.level),
        tag("type", p.type),
        tag("title", p.title),
        tag("description", p.description),
        ...prices.map(
          (pr) =>
            `<price operation="${esc(pr.operation)}" currency="${esc(pr.currency)}">${units(pr.listMinor ?? 0n)}</price>`,
        ),
        `<location>${tag("neighborhood", neighborhoodName)}${tag("city", localityName)}${tag("latitude", approx(p.latitude))}${tag("longitude", approx(p.longitude))}</location>`,
        tag("bedrooms", p.bedrooms),
        tag("bathrooms", p.bathrooms),
        tag("garages", p.garages),
        tag("builtArea", p.builtArea),
        tag("totalArea", p.totalArea),
        tag("petsAllowed", p.petsAllowed ? "true" : "false"),
        tag("furnished", p.furnished ? "true" : "false"),
        `<features>${p.features.map((f) => tag("feature", f)).join("")}</features>`,
        `<photos>${photoIds.map((id) => `<photo url="${esc(`${origin}/api/feeds/${token}/media/${id}`)}"/>`).join("")}</photos>`,
        tag("updatedAt", p.updatedAt.toISOString()),
        "</listing>",
      ].join(""),
    )
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<listings portal="${esc(feed.account.portal)}" generatedAt="${new Date().toISOString()}" count="${feed.listings.length}">\n${body}\n</listings>\n`;
  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
