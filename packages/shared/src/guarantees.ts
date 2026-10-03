/**
 * Garantías de alquiler (Fase 8). Cada tipo trae su lista de requisitos por defecto; el trámite
 * pasa por estados y, una vez vigente, se controla su vencimiento.
 */

export const GUARANTEE_TYPES = [
  "anda",
  "cgn",
  "mvot",
  "insurance",
  "deposit",
  "property_guarantor",
  "other",
] as const;
export type GuaranteeType = (typeof GUARANTEE_TYPES)[number];
export const GUARANTEE_TYPE_LABELS: Record<GuaranteeType, string> = {
  anda: "ANDA",
  cgn: "Contaduría General de la Nación (CGN)",
  mvot: "Fondo de Garantía de Alquileres (MVOT)",
  insurance: "Seguro de fianza",
  deposit: "Depósito en garantía",
  property_guarantor: "Garantía propietaria (fiador)",
  other: "Otra",
};
export const GUARANTEE_TYPE_SHORT: Record<GuaranteeType, string> = {
  anda: "ANDA",
  cgn: "CGN",
  mvot: "MVOT",
  insurance: "Seguro",
  deposit: "Depósito",
  property_guarantor: "Propietaria",
  other: "Otra",
};

/** Requisitos sugeridos por tipo (se copian al crear la garantía y se pueden tildar). */
export const GUARANTEE_REQUIREMENTS: Record<GuaranteeType, readonly string[]> = {
  anda: ["Socio de ANDA al día", "Cédula de identidad", "Últimos recibos de sueldo", "Solicitud firmada"],
  cgn: [
    "Funcionario público o pasivo",
    "Cédula de identidad",
    "Recibo de sueldo",
    "Certificado de CGN emitido",
  ],
  mvot: [
    "Inscripción en el programa",
    "Cédula de identidad",
    "Constancia de ingresos",
    "Aprobación del MVOT",
  ],
  insurance: [
    "Solicitud a la aseguradora",
    "Cédula de identidad",
    "Constancia de ingresos",
    "Póliza emitida",
  ],
  deposit: ["Depósito realizado", "Comprobante del depósito", "Constancia de titularidad"],
  property_guarantor: [
    "Cédula del fiador",
    "Título del inmueble",
    "Certificado registral sin gravámenes",
    "Firma del fiador en el contrato",
  ],
  other: ["Documentación recibida"],
};

/** Dónde queda un depósito en garantía. */
export const DEPOSIT_PLACES = ["bhu", "agency", "owner", "other"] as const;
export type DepositPlace = (typeof DEPOSIT_PLACES)[number];
export const DEPOSIT_PLACE_LABELS: Record<DepositPlace, string> = {
  bhu: "BHU",
  agency: "Inmobiliaria",
  owner: "Propietario",
  other: "Otro",
};

export const GUARANTEE_STATUSES = [
  "in_process",
  "approved",
  "rejected",
  "active",
  "expired",
  "released",
] as const;
export type GuaranteeStatus = (typeof GUARANTEE_STATUSES)[number];
export const GUARANTEE_STATUS_LABELS: Record<GuaranteeStatus, string> = {
  in_process: "En trámite",
  approved: "Aprobada",
  rejected: "Rechazada",
  active: "Vigente",
  expired: "Vencida",
  released: "Liberada",
};

/** Trámite → aprobada/rechazada → vigente (con contrato) → vencida o liberada. */
export function canTransitionGuarantee(from: GuaranteeStatus, to: GuaranteeStatus): boolean {
  const allowed: Record<GuaranteeStatus, readonly GuaranteeStatus[]> = {
    in_process: ["approved", "rejected"],
    approved: ["active", "rejected", "in_process"],
    rejected: ["in_process"],
    active: ["expired", "released"],
    expired: ["active", "released"],
    released: [],
  };
  return allowed[from].includes(to);
}

export const GUARANTEE_EXPIRY_ALERT_DAYS = 60;
export const GUARANTEE_STALE_DAYS = 15;

export interface GuaranteeRequirement {
  label: string;
  done: boolean;
}

export type GuaranteeAlert = "expiring" | "expired" | "stale" | "missing_requirements";
export const GUARANTEE_ALERT_LABELS: Record<GuaranteeAlert, string> = {
  expiring: "Vence pronto",
  expired: "Vencida sin renovar",
  stale: "Trámite demorado",
  missing_requirements: "Faltan requisitos",
};

function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

export function guaranteeAlerts(
  g: {
    status: GuaranteeStatus;
    validUntil: string | null;
    requestedAt: string;
    requirements: GuaranteeRequirement[];
  },
  today: string,
): GuaranteeAlert[] {
  const out: GuaranteeAlert[] = [];
  if (g.status === "active" && g.validUntil) {
    if (g.validUntil < today) out.push("expired");
    else if (daysBetween(today, g.validUntil) <= GUARANTEE_EXPIRY_ALERT_DAYS) out.push("expiring");
  }
  if (g.status === "in_process" && daysBetween(g.requestedAt, today) > GUARANTEE_STALE_DAYS)
    out.push("stale");
  if ((g.status === "in_process" || g.status === "approved") && g.requirements.some((r) => !r.done))
    out.push("missing_requirements");
  return out;
}
