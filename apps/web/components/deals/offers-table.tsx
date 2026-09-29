import { dealStageLabel, type DealStage, type PropertyOperation } from "@crm/shared";
import {
  isOfferExpired,
  OFFER_PARTY_LABELS,
  OFFER_STATUS_LABELS,
  type OfferParty,
  type OfferStatus,
} from "@crm/shared/offers";
import Link from "next/link";
import { formatDay, price } from "@/components/properties/format";
import { Badge } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export interface OfferRow {
  id: string;
  dealId: string;
  dealCode: string;
  dealStage: DealStage;
  operation: PropertyOperation;
  party: OfferParty;
  status: OfferStatus;
  currency: "USD" | "UYU";
  amountMinor: bigint;
  conditions: string | null;
  validUntil: string | null;
  createdAt: Date;
  propertyId: string;
  propertyCode: string;
  propertyLabel: string;
  clientName: string;
  agentName: string | null;
}

const TONE: Record<OfferStatus, "warning" | "primary" | "success" | "danger" | "neutral"> = {
  pending: "warning",
  countered: "primary",
  accepted: "success",
  rejected: "danger",
  withdrawn: "neutral",
};

/** Tabla de ofertas (bandeja de ofertas y pestaña de la propiedad). */
export function OffersTable({
  rows,
  today,
  showProperty = true,
}: {
  rows: OfferRow[];
  today: string;
  showProperty?: boolean;
}) {
  return (
    <Table>
      <THead>
        <TR className="hover:bg-transparent">
          <TH>Operación</TH>
          {showProperty && <TH>Propiedad</TH>}
          <TH>Cliente</TH>
          <TH>Ofrece</TH>
          <TH className="text-right">Monto</TH>
          <TH>Estado</TH>
          <TH>Válida hasta</TH>
          <TH>Agente</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((o) => {
          const expired = isOfferExpired(o, today);
          return (
            <TR key={o.id}>
              <TD>
                <Link
                  href={`/commercial/deals/${o.dealId}`}
                  className="font-mono text-xs text-primary hover:underline"
                >
                  {o.dealCode}
                </Link>
                <span className="block text-xs text-muted-foreground">
                  {dealStageLabel(o.dealStage, o.operation)}
                </span>
              </TD>
              {showProperty && (
                <TD>
                  <Link href={`/properties/${o.propertyId}`} className="hover:underline">
                    {o.propertyLabel}
                  </Link>
                  <span className="block font-mono text-xs text-muted-foreground">{o.propertyCode}</span>
                </TD>
              )}
              <TD>{o.clientName}</TD>
              <TD>{OFFER_PARTY_LABELS[o.party]}</TD>
              <TD className="text-right font-semibold tabular">{price(o.amountMinor, o.currency)}</TD>
              <TD>
                <Badge tone={expired ? "danger" : TONE[o.status]}>
                  {expired ? "Vencida sin respuesta" : OFFER_STATUS_LABELS[o.status]}
                </Badge>
                {o.conditions && (
                  <span className="block max-w-56 truncate text-xs text-muted-foreground">
                    {o.conditions}
                  </span>
                )}
              </TD>
              <TD>{formatDay(o.validUntil)}</TD>
              <TD className="text-muted-foreground">{o.agentName ?? "—"}</TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}
