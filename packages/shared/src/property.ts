/**
 * Catálogos y reglas puras de inmuebles, captaciones, tasaciones y documentos.
 */

export const PROPERTY_OPERATIONS = ["sale", "rent", "temporary_rent"] as const;
export type PropertyOperation = (typeof PROPERTY_OPERATIONS)[number];
export const PROPERTY_OPERATION_LABELS: Record<PropertyOperation, string> = {
  sale: "Venta",
  rent: "Alquiler",
  temporary_rent: "Alquiler temporal",
};

export const PROPERTY_STATUSES = [
  "draft",
  "available",
  "published",
  "negotiating",
  "reserved",
  "rented",
  "sold",
  "paused",
  "withdrawn",
] as const;
export type PropertyStatus = (typeof PROPERTY_STATUSES)[number];
export const PROPERTY_STATUS_LABELS: Record<PropertyStatus, string> = {
  draft: "Borrador",
  available: "Disponible",
  published: "Publicado",
  negotiating: "En negociación",
  reserved: "Reservado",
  rented: "Alquilado",
  sold: "Vendido",
  paused: "Pausado",
  withdrawn: "Retirado",
};

/** Estados en los que la propiedad se ofrece (cuenta como inventario activo). */
export const ACTIVE_PROPERTY_STATUSES: readonly PropertyStatus[] = [
  "available",
  "published",
  "negotiating",
  "reserved",
];

/**
 * Transiciones manuales. "Reservado" y "En negociación" los fijarán las reservas y ofertas
 * (Fases 6-7); mientras tanto se permiten a mano y quedan auditados.
 */
const TRANSITIONS: Record<PropertyStatus, readonly PropertyStatus[]> = {
  draft: ["available", "published", "withdrawn"],
  available: ["published", "negotiating", "reserved", "paused", "withdrawn", "sold", "rented"],
  published: ["available", "negotiating", "reserved", "paused", "withdrawn", "sold", "rented"],
  negotiating: ["published", "available", "reserved", "paused", "withdrawn", "sold", "rented"],
  reserved: ["published", "available", "negotiating", "sold", "rented", "withdrawn"],
  rented: ["available", "published", "withdrawn"],
  sold: ["withdrawn"],
  paused: ["available", "published", "withdrawn"],
  withdrawn: ["draft"],
};

export function canTransitionProperty(from: PropertyStatus, to: PropertyStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedPropertyTransitions(from: PropertyStatus): readonly PropertyStatus[] {
  return TRANSITIONS[from];
}

export const ORIENTATIONS = [
  "north",
  "south",
  "east",
  "west",
  "northeast",
  "northwest",
  "southeast",
  "southwest",
] as const;
export type Orientation = (typeof ORIENTATIONS)[number];
export const ORIENTATION_LABELS: Record<Orientation, string> = {
  north: "Norte",
  south: "Sur",
  east: "Este",
  west: "Oeste",
  northeast: "Noreste",
  northwest: "Noroeste",
  southeast: "Sureste",
  southwest: "Suroeste",
};

export const PROPERTY_CONDITIONS = [
  "new",
  "excellent",
  "very_good",
  "good",
  "to_renovate",
  "under_construction",
] as const;
export type PropertyCondition = (typeof PROPERTY_CONDITIONS)[number];
export const PROPERTY_CONDITION_LABELS: Record<PropertyCondition, string> = {
  new: "A estrenar",
  excellent: "Excelente",
  very_good: "Muy bueno",
  good: "Bueno",
  to_renovate: "A reciclar",
  under_construction: "En construcción",
};

export const EXPENSE_KINDS = ["common_expenses", "property_tax", "primary_tax", "other"] as const;
export type ExpenseKind = (typeof EXPENSE_KINDS)[number];
export const EXPENSE_KIND_LABELS: Record<ExpenseKind, string> = {
  common_expenses: "Gastos comunes",
  property_tax: "Contribución inmobiliaria",
  primary_tax: "Impuesto de Primaria",
  other: "Otro gasto",
};

export const EXPENSE_PERIODS = ["monthly", "bimonthly", "annual", "one_time"] as const;
export type ExpensePeriod = (typeof EXPENSE_PERIODS)[number];
export const EXPENSE_PERIOD_LABELS: Record<ExpensePeriod, string> = {
  monthly: "Mensual",
  bimonthly: "Bimestral",
  annual: "Anual",
  one_time: "Único",
};

export const MEDIA_KINDS = ["photo", "floor_plan", "video"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];
export const MEDIA_KIND_LABELS: Record<MediaKind, string> = {
  photo: "Foto",
  floor_plan: "Plano",
  video: "Video",
};

export const PRICE_FIELDS = ["list", "owner_asking", "minimum"] as const;
export type PriceField = (typeof PRICE_FIELDS)[number];
export const PRICE_FIELD_LABELS: Record<PriceField, string> = {
  list: "Precio publicado",
  owner_asking: "Pedido por el propietario",
  minimum: "Mínimo autorizado",
};

/** Lo mínimo para publicar una propiedad. Devuelve lo que falta (vacío = lista para publicar). */
export function publishChecklist(p: {
  title: string | null;
  description: string | null;
  localityId: number | null;
  operations: readonly string[];
  listPrices: readonly { operation: string; hasListPrice: boolean }[];
  photoCount: number;
  hasCover: boolean;
  ownerShareTotal: number;
  ownerCount: number;
}): string[] {
  const missing: string[] = [];
  if (!p.title || p.title.trim().length < 8) missing.push("Título de al menos 8 caracteres");
  if (!p.description || p.description.trim().length < 40)
    missing.push("Descripción de al menos 40 caracteres");
  if (!p.localityId) missing.push("Ubicación (localidad)");
  if (p.operations.length === 0) missing.push("Al menos una operación (venta o alquiler)");
  for (const op of p.operations) {
    if (!p.listPrices.some((lp) => lp.operation === op && lp.hasListPrice)) {
      missing.push(`Precio publicado de ${PROPERTY_OPERATION_LABELS[op as PropertyOperation] ?? op}`);
    }
  }
  if (p.photoCount < 3) missing.push("Al menos 3 fotos");
  if (!p.hasCover) missing.push("Foto de portada");
  if (p.ownerCount === 0) missing.push("Propietario");
  else if (p.ownerShareTotal !== 10_000) missing.push("Participaciones de propietarios que sumen 100 %");
  return missing;
}

export const ACQUISITION_STAGES = [
  "prospect",
  "contacted",
  "valuation",
  "negotiation",
  "authorization",
  "captured",
  "published",
  "lost",
] as const;
export type AcquisitionStage = (typeof ACQUISITION_STAGES)[number];
export const ACQUISITION_STAGE_LABELS: Record<AcquisitionStage, string> = {
  prospect: "Prospecto",
  contacted: "Contactado",
  valuation: "Tasación",
  negotiation: "Negociación",
  authorization: "Autorización",
  captured: "Captado",
  published: "Publicado",
  lost: "Perdido",
};
export const OPEN_ACQUISITION_STAGES: readonly AcquisitionStage[] = [
  "prospect",
  "contacted",
  "valuation",
  "negotiation",
  "authorization",
];

/**
 * Captación: avanza o retrocede entre etapas abiertas; "Captado" exige autorización previa;
 * "Publicado" lo pone el sistema cuando se publica la propiedad; "Perdido" desde cualquier
 * etapa abierta; un perdido se puede reabrir como prospecto.
 */
export function canTransitionAcquisition(from: AcquisitionStage, to: AcquisitionStage): boolean {
  if (from === to) return false;
  const fromOpen = OPEN_ACQUISITION_STAGES.includes(from);
  if (to === "lost") return fromOpen;
  if (to === "captured") return from === "authorization";
  if (to === "published") return false;
  if (from === "lost") return to === "prospect";
  return fromOpen && OPEN_ACQUISITION_STAGES.includes(to);
}

export const VALUATION_METHODS = ["comparables", "cost", "income", "mixed"] as const;
export type ValuationMethod = (typeof VALUATION_METHODS)[number];
export const VALUATION_METHOD_LABELS: Record<ValuationMethod, string> = {
  comparables: "Comparables de mercado",
  cost: "Costo de reposición",
  income: "Renta",
  mixed: "Mixto",
};

export const DOCUMENT_CATEGORIES = [
  "property",
  "owner",
  "client",
  "deal",
  "contract",
  "guarantee",
  "finance",
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];
export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  property: "Propiedad",
  owner: "Propietario",
  client: "Cliente",
  deal: "Operación",
  contract: "Contrato",
  guarantee: "Garantía",
  finance: "Finanzas",
};

export const DOCUMENT_VISIBILITIES = ["internal", "restricted", "confidential"] as const;
export type DocumentVisibility = (typeof DOCUMENT_VISIBILITIES)[number];
export const DOCUMENT_VISIBILITY_LABELS: Record<DocumentVisibility, string> = {
  internal: "Interno (quien ve el registro)",
  restricted: "Restringido (responsable y supervisores)",
  confidential: "Confidencial (permiso especial)",
};

export const DOCUMENT_STATUSES = ["valid", "pending", "expired", "archived"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];
export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  valid: "Vigente",
  pending: "Pendiente de revisión",
  expired: "Vencido",
  archived: "Archivado",
};

/** Tipos de documento sugeridos (texto libre en la base: cada inmobiliaria usa los suyos). */
export const SUGGESTED_DOCUMENT_TYPES: Record<string, readonly string[]> = {
  property: [
    "Título de propiedad",
    "Plano",
    "Certificado de contribución",
    "Libre de deudas (BPS)",
    "Reglamento de copropiedad",
    "Autorización de venta",
  ],
  owner: ["Cédula", "Poder notarial", "Constancia de RUT", "Estado de cuenta bancaria"],
  client: ["Cédula", "Recibo de sueldo", "Constancia de ingresos"],
};

/** Tipos de archivo aceptados, verificados por su contenido (magic bytes), no por la extensión. */
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const ACCEPTED_DOCUMENT_TYPES = [...ACCEPTED_IMAGE_TYPES, "application/pdf"] as const;
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

/** Detecta el tipo real del archivo por sus primeros bytes. */
export function sniffMimeType(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return "image/webp";
  }
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d)
    return "application/pdf";
  return null;
}
