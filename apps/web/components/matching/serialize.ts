import type { leadMatches } from "@crm/core";
import type { MatchItem } from "./match-list";

type Row = Awaited<ReturnType<typeof leadMatches>>["items"][number];

/** Fila del servicio → props serializables para el cliente (sin bigint ni Date). */
export function toMatchItem(r: Row): MatchItem {
  const area = r.builtArea ?? r.totalArea;
  return {
    id: r.id,
    status: r.status,
    score: r.score,
    reasons: r.reasons,
    active: r.active,
    note: r.note,
    propertyId: r.propertyId,
    code: r.code,
    displayTitle: r.displayTitle,
    zone: [r.neighborhoodName, r.localityName].filter(Boolean).join(", "),
    specs: [
      r.bedrooms !== null ? `${r.bedrooms} dorm.` : null,
      r.bathrooms !== null ? `${r.bathrooms} baño${r.bathrooms === 1 ? "" : "s"}` : null,
      area ? `${area.replace(/\.00$/, "")} m²` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    price: r.price ? { currency: r.price.currency, amountMinor: r.price.amountMinor.toString() } : null,
    coverMediaId: r.coverMediaId,
    agentName: r.agentName,
  };
}
