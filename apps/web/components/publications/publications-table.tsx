import {
  AD_LEVEL_LABELS,
  PORTAL_LABELS,
  PUBLICATION_ALERT_LABELS,
  PUBLICATION_STATUS_LABELS,
  type AdLevel,
  type Portal,
  type PublicationAlert,
  type PublicationStatus,
} from "@crm/shared/publications";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { formatDay } from "@/components/properties/format";
import { PublicationActions } from "@/components/publications/publication-controls";
import { Badge } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export interface PublicationRow {
  id: string;
  portal: Portal;
  level: AdLevel;
  status: PublicationStatus;
  url: string | null;
  externalId: string | null;
  expiresAt: string | null;
  views: number | null;
  contacts: number | null;
  notes: string | null;
  propertyId: string;
  propertyCode: string;
  propertyLabel: string;
  zone: string | null;
  alerts: PublicationAlert[];
  syncError?: string | null;
}

const LEVEL_TONE: Record<AdLevel, "neutral" | "outline" | "warning" | "primary"> = {
  basic: "neutral",
  silver: "outline",
  gold: "warning",
  premium: "primary",
};

export function PublicationsTable({
  rows,
  canManage,
  showProperty = true,
}: {
  rows: PublicationRow[];
  canManage: boolean;
  showProperty?: boolean;
}) {
  return (
    <Table>
      <THead>
        <TR className="hover:bg-transparent">
          {showProperty && <TH>Propiedad</TH>}
          <TH>Portal</TH>
          <TH>Nivel</TH>
          <TH>Vence</TH>
          <TH className="text-right">Visitas</TH>
          <TH className="text-right">Contactos</TH>
          <TH>Estado</TH>
          {canManage && <TH />}
        </TR>
      </THead>
      <TBody>
        {rows.map((r) => (
          <TR key={r.id}>
            {showProperty && (
              <TD>
                <Link href={`/properties/${r.propertyId}?tab=publications`} className="hover:underline">
                  {r.propertyLabel}
                </Link>
                <span className="block text-xs text-muted-foreground">
                  <span className="font-mono">{r.propertyCode}</span>
                  {r.zone ? ` · ${r.zone}` : ""}
                </span>
              </TD>
            )}
            <TD>
              {r.url ? (
                <a
                  href={r.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  {PORTAL_LABELS[r.portal]} <ExternalLink className="size-3" />
                </a>
              ) : (
                PORTAL_LABELS[r.portal]
              )}
              {r.externalId && <span className="block text-xs text-muted-foreground">#{r.externalId}</span>}
              {r.syncError && (
                <span className="block max-w-56 text-xs text-danger" title={r.syncError}>
                  Error al sincronizar: {r.syncError.slice(0, 90)}
                </span>
              )}
            </TD>
            <TD>
              <Badge tone={LEVEL_TONE[r.level]}>{AD_LEVEL_LABELS[r.level]}</Badge>
            </TD>
            <TD>{formatDay(r.expiresAt)}</TD>
            <TD className="text-right tabular">{r.views ?? "—"}</TD>
            <TD className="text-right tabular">{r.contacts ?? "—"}</TD>
            <TD>
              <span className="flex flex-wrap gap-1">
                <Badge
                  tone={r.status === "published" ? "success" : r.status === "removed" ? "neutral" : "warning"}
                >
                  {PUBLICATION_STATUS_LABELS[r.status]}
                </Badge>
                {r.alerts.map((a) => (
                  <Badge
                    key={a}
                    tone={a === "property_unavailable" || a === "expired" ? "danger" : "warning"}
                  >
                    {PUBLICATION_ALERT_LABELS[a]}
                  </Badge>
                ))}
              </span>
            </TD>
            {canManage && (
              <TD>
                <PublicationActions p={r} />
              </TD>
            )}
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
