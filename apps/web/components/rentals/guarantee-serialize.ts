import type { listGuarantees } from "@crm/core";
import type { GuaranteeView } from "./guarantees-panel";

type Row = Awaited<ReturnType<typeof listGuarantees>>["items"][number];

export function toGuaranteeView(g: Row): GuaranteeView {
  return {
    id: g.id,
    type: g.type,
    status: g.status,
    provider: g.provider,
    reference: g.reference,
    currency: g.currency,
    coverageMinor: g.coverageMinor?.toString() ?? null,
    requestedAt: g.requestedAt,
    validFrom: g.validFrom,
    validUntil: g.validUntil,
    depositPlace: g.depositPlace,
    guarantorContactId: g.guarantorContactId,
    guarantorName: g.guarantorName,
    requirements: g.requirements,
    notes: g.notes,
    statusNote: g.statusNote,
    contractId: g.contractId,
    contractCode: g.contractCode,
    alerts: g.alerts,
    shortOfContract: g.shortOfContract,
  };
}
