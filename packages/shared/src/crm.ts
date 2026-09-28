/**
 * Catálogos del CRM. Son listas cerradas del dominio (no normativa), por eso viven en código;
 * lo configurable por organización (etiquetas, orígenes propios) vive en tablas.
 */

export const CONTACT_KINDS = ["person", "company"] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];
export const CONTACT_KIND_LABELS: Record<ContactKind, string> = { person: "Persona", company: "Empresa" };

export const DOCUMENT_TYPES = ["ci", "passport", "rut", "dni", "other"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  ci: "Cédula uruguaya",
  passport: "Pasaporte",
  rut: "RUT",
  dni: "DNI extranjero",
  other: "Otro",
};

export const CHANNEL_TYPES = ["phone", "whatsapp", "email"] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];
export const CHANNEL_TYPE_LABELS: Record<ChannelType, string> = {
  phone: "Teléfono",
  whatsapp: "WhatsApp",
  email: "Email",
};

export const LEAD_OPERATIONS = ["buy", "rent", "temporary_rent"] as const;
export type LeadOperation = (typeof LEAD_OPERATIONS)[number];
export const LEAD_OPERATION_LABELS: Record<LeadOperation, string> = {
  buy: "Compra",
  rent: "Alquiler",
  temporary_rent: "Alquiler temporal",
};

export const LEAD_SOURCES = [
  "portal",
  "website",
  "whatsapp",
  "phone",
  "walk_in",
  "referral",
  "social",
  "sign",
  "other",
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];
export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  portal: "Portal inmobiliario",
  website: "Sitio web",
  whatsapp: "WhatsApp",
  phone: "Llamada",
  walk_in: "Visita a la oficina",
  referral: "Referido",
  social: "Redes sociales",
  sign: "Cartel",
  other: "Otro",
};

/** Embudo comercial: Lead → Contactado → Calificado → Visita → Oferta → Reserva → Cierre. */
export const LEAD_STATUSES = [
  "new",
  "contacted",
  "qualified",
  "visit",
  "offer",
  "reservation",
  "won",
  "lost",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "Nuevo",
  contacted: "Contactado",
  qualified: "Calificado",
  visit: "Visita",
  offer: "Oferta",
  reservation: "Reserva",
  won: "Cerrado",
  lost: "Perdido",
};
export const OPEN_LEAD_STATUSES: readonly LeadStatus[] = [
  "new",
  "contacted",
  "qualified",
  "visit",
  "offer",
  "reservation",
];

export const LEAD_LOST_REASONS = [
  "no_response",
  "price",
  "bought_elsewhere",
  "no_longer_interested",
  "financing",
  "no_match",
  "duplicate",
  "other",
] as const;
export type LeadLostReason = (typeof LEAD_LOST_REASONS)[number];
export const LEAD_LOST_REASON_LABELS: Record<LeadLostReason, string> = {
  no_response: "No responde",
  price: "Precio",
  bought_elsewhere: "Compró o alquiló por otro lado",
  no_longer_interested: "Ya no está interesado",
  financing: "No consiguió financiación o garantía",
  no_match: "No hay propiedades que se ajusten",
  duplicate: "Duplicado",
  other: "Otro",
};

/**
 * Transiciones del embudo. Se puede avanzar varias etapas o retroceder entre etapas abiertas
 * (el proceso real no es lineal), pasar a Perdido desde cualquier etapa abierta y reabrir un
 * perdido. "Cerrado" solo desde Reserva; desde la Fase 7 lo hará la operación automáticamente.
 */
export function canTransitionLead(from: LeadStatus, to: LeadStatus): boolean {
  if (from === to) return false;
  const fromOpen = OPEN_LEAD_STATUSES.includes(from);
  if (to === "lost") return fromOpen;
  if (to === "won") return from === "reservation";
  if (from === "lost") return to === "new" || to === "contacted";
  if (from === "won") return false;
  return fromOpen && OPEN_LEAD_STATUSES.includes(to);
}

export const PROPERTY_TYPES = [
  "apartment",
  "house",
  "ph",
  "land",
  "office",
  "commercial",
  "warehouse",
  "farm",
  "garage",
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];
export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  apartment: "Apartamento",
  house: "Casa",
  ph: "PH",
  land: "Terreno",
  office: "Oficina",
  commercial: "Local comercial",
  warehouse: "Depósito / galpón",
  farm: "Chacra / campo",
  garage: "Cochera",
};

export const PROPERTY_FEATURES = [
  "terrace",
  "balcony",
  "patio",
  "barbecue",
  "pool",
  "elevator",
  "doorman",
  "security",
  "heating",
  "air_conditioning",
  "garden",
] as const;
export type PropertyFeature = (typeof PROPERTY_FEATURES)[number];
export const PROPERTY_FEATURE_LABELS: Record<PropertyFeature, string> = {
  terrace: "Terraza",
  balcony: "Balcón",
  patio: "Patio",
  barbecue: "Parrillero",
  pool: "Piscina",
  elevator: "Ascensor",
  doorman: "Portería",
  security: "Seguridad",
  heating: "Calefacción",
  air_conditioning: "Aire acondicionado",
  garden: "Jardín",
};

/** Tipos de entrada del timeline. Los de fases futuras ya quedan reservados. */
export const ACTIVITY_TYPES = [
  "note",
  "call",
  "whatsapp",
  "email",
  "meeting",
  "contact_created",
  "contact_updated",
  "contact_merged",
  "lead_created",
  "lead_status_changed",
  "lead_assigned",
  "search_updated",
  "owner_updated",
  "property_sent",
  "visit",
  "offer",
  "document",
  "task",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

/** Interacciones que registra una persona (no automáticas). */
export const INTERACTION_TYPES = [
  "note",
  "call",
  "whatsapp",
  "email",
  "meeting",
] as const satisfies readonly ActivityType[];
export type InteractionType = (typeof INTERACTION_TYPES)[number];
export const INTERACTION_TYPE_LABELS: Record<InteractionType, string> = {
  note: "Nota",
  call: "Llamada",
  whatsapp: "WhatsApp",
  email: "Email",
  meeting: "Reunión",
};

/** Vínculos entre contactos (se muestran en ambas fichas). */
export const RELATION_TYPES = [
  "spouse",
  "family",
  "partner",
  "lawyer",
  "notary",
  "guarantor",
  "referrer",
  "other",
] as const;
export type RelationType = (typeof RELATION_TYPES)[number];
export const RELATION_TYPE_LABELS: Record<RelationType, string> = {
  spouse: "Cónyuge o pareja",
  family: "Familiar",
  partner: "Socio",
  lawyer: "Abogado",
  notary: "Escribano",
  guarantor: "Garante",
  referrer: "Lo refirió",
  other: "Otro",
};
