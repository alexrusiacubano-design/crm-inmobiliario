/**
 * Ofertas y reservas (Fase 6). Viven dentro de una operación: el cliente ofrece, el propietario
 * contraoferta, y cuando hay acuerdo se registra la reserva con la seña.
 */

export const OFFER_PARTIES = ["client", "owner"] as const;
export type OfferParty = (typeof OFFER_PARTIES)[number];
export const OFFER_PARTY_LABELS: Record<OfferParty, string> = {
  client: "Cliente",
  owner: "Propietario",
};

export const OFFER_STATUSES = ["pending", "countered", "accepted", "rejected", "withdrawn"] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];
export const OFFER_STATUS_LABELS: Record<OfferStatus, string> = {
  pending: "Pendiente de respuesta",
  countered: "Contraofertada",
  accepted: "Aceptada",
  rejected: "Rechazada",
  withdrawn: "Retirada",
};

/** Respuestas posibles a una oferta pendiente. */
export const OFFER_RESPONSES = ["accept", "reject", "counter", "withdraw"] as const;
export type OfferResponse = (typeof OFFER_RESPONSES)[number];

/** Quién tiene la seña. */
export const DEPOSIT_HOLDERS = ["agency", "owner", "notary"] as const;
export type DepositHolder = (typeof DEPOSIT_HOLDERS)[number];
export const DEPOSIT_HOLDER_LABELS: Record<DepositHolder, string> = {
  agency: "Inmobiliaria",
  owner: "Propietario",
  notary: "Escribanía",
};

export const RESERVATION_STATUSES = ["active", "converted", "refunded", "forfeited"] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];
export const RESERVATION_STATUS_LABELS: Record<ReservationStatus, string> = {
  active: "Vigente",
  converted: "Pasó a boleto / contrato",
  refunded: "Cancelada · seña devuelta",
  forfeited: "Cancelada · seña retenida",
};

/** Cómo termina una reserva cancelada y qué pasa con la operación. */
export const RESERVATION_CANCEL_OUTCOMES = ["refunded", "forfeited"] as const;
export type ReservationCancelOutcome = (typeof RESERVATION_CANCEL_OUTCOMES)[number];

/** Días hasta el vencimiento (negativo = vencida). Fechas ISO sin hora. */
export function daysBetween(fromYmd: string, toYmd: string): number {
  const a = Date.UTC(+fromYmd.slice(0, 4), +fromYmd.slice(5, 7) - 1, +fromYmd.slice(8, 10));
  const b = Date.UTC(+toYmd.slice(0, 4), +toYmd.slice(5, 7) - 1, +toYmd.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/** Una oferta pendiente con fecha de validez pasada se muestra vencida. */
export function isOfferExpired(
  o: { status: OfferStatus; validUntil: string | null },
  todayYmd: string,
): boolean {
  return o.status === "pending" && o.validUntil !== null && o.validUntil < todayYmd;
}

/** La contraparte de quien hizo la última oferta. */
export function otherParty(p: OfferParty): OfferParty {
  return p === "client" ? "owner" : "client";
}

/** Escribano de una de las partes (datos de contacto para coordinar la firma). */
export interface ReservationNotary {
  name: string;
  phone: string | null;
  email: string | null;
}
