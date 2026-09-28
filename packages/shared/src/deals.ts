/**
 * Operaciones (venta, alquiler, temporario) y comisiones. Una operación nace cuando un
 * cliente decide avanzar con una propiedad y termina firmada o caída.
 */

import type { PropertyOperation } from "./property";

export const DEAL_STAGES = ["negotiation", "reserved", "notary", "signed", "closed", "fallen"] as const;
export type DealStage = (typeof DEAL_STAGES)[number];
export const DEAL_STAGE_LABELS: Record<DealStage, string> = {
  negotiation: "En negociación",
  reserved: "Reservada",
  notary: "En escribanía",
  signed: "Boleto / compromiso firmado",
  closed: "Cerrada",
  fallen: "Se cayó",
};
/** Para alquileres el lenguaje cambia: no hay escritura sino contrato. */
export const RENT_STAGE_LABELS: Partial<Record<DealStage, string>> = {
  notary: "Garantía y documentación",
  signed: "Contrato firmado",
};
export function dealStageLabel(stage: DealStage, operation: PropertyOperation): string {
  return (operation !== "sale" && RENT_STAGE_LABELS[stage]) || DEAL_STAGE_LABELS[stage];
}

export const OPEN_DEAL_STAGES: readonly DealStage[] = ["negotiation", "reserved", "notary", "signed"];

/** Avance lineal hacia adelante, un paso atrás permitido, y caída desde cualquier etapa abierta. */
export function canTransitionDeal(from: DealStage, to: DealStage): boolean {
  if (from === to) return false;
  if (from === "closed") return false;
  if (from === "fallen") return to === "negotiation";
  if (to === "fallen") return true;
  const order = OPEN_DEAL_STAGES.indexOf(from);
  const next = to === "closed" ? OPEN_DEAL_STAGES.length : OPEN_DEAL_STAGES.indexOf(to);
  if (next < 0) return false;
  return next > order || next === order - 1;
}

/** Quién paga cada honorario. */
export const COMMISSION_SIDES = ["buyer", "seller", "tenant", "landlord"] as const;
export type CommissionSide = (typeof COMMISSION_SIDES)[number];
export const COMMISSION_SIDE_LABELS: Record<CommissionSide, string> = {
  buyer: "Comprador",
  seller: "Vendedor",
  tenant: "Inquilino",
  landlord: "Propietario",
};
export function sidesFor(operation: PropertyOperation): readonly CommissionSide[] {
  return operation === "sale" ? ["seller", "buyer"] : ["landlord", "tenant"];
}

export const COMMISSION_STATUSES = ["pending", "collected", "cancelled"] as const;
export type CommissionStatus = (typeof COMMISSION_STATUSES)[number];
export const COMMISSION_STATUS_LABELS: Record<CommissionStatus, string> = {
  pending: "Pendiente",
  collected: "Cobrada",
  cancelled: "Anulada",
};

export const PARTICIPANT_ROLES = ["lister", "seller_agent", "collaborator", "referrer"] as const;
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];
export const PARTICIPANT_ROLE_LABELS: Record<ParticipantRole, string> = {
  lister: "Captador",
  seller_agent: "Cerró la operación",
  collaborator: "Colaborador",
  referrer: "Referido",
};
