import { propertyMatches, type RequestContext } from "@crm/core";
import type { Db } from "@crm/db";
import { LEAD_OPERATION_LABELS } from "@crm/shared";
import { MATCH_STATUS_LABELS } from "@crm/shared/matching";
import { MessageCircle, Users } from "lucide-react";
import Link from "next/link";
import { ScoreBadge } from "@/components/matching/match-list";
import { Badge, Card, EmptyState } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { whatsappLink } from "@/lib/utils";

/** Pestaña "Clientes compatibles" de la ficha de propiedad. */
export async function PropertyMatchesPanel({
  db,
  ctx,
  propertyId,
}: {
  db: Db;
  ctx: RequestContext;
  propertyId: string;
}) {
  const { items, matchable } = await propertyMatches(db, ctx, propertyId);
  const active = items.filter((i) => i.active);
  const inactive = items.filter((i) => !i.active);
  return (
    <Card>
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Clientes compatibles</h2>
        <p className="text-xs text-muted-foreground">
          Leads abiertos cuya búsqueda coincide con esta propiedad. Enviala o descartala desde la ficha del
          lead.
        </p>
      </div>
      {!matchable && (
        <p className="border-b bg-warning-soft/40 px-4 py-2 text-xs">
          La propiedad no está disponible ni publicada: no se sugiere a clientes nuevos.
        </p>
      )}
      {items.length === 0 ? (
        <EmptyState
          icon={Users}
          className="py-10"
          title="Ningún cliente compatible"
          description="Cuando un lead cargue una búsqueda que coincida, aparece acá."
        />
      ) : (
        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              <TH>Cliente</TH>
              <TH>Busca</TH>
              <TH>Compatibilidad</TH>
              <TH>Estado</TH>
              <TH>Agente</TH>
              <TH className="w-10" />
            </TR>
          </THead>
          <TBody>
            {[...active, ...inactive].map((m) => {
              const wa = whatsappLink(m.phone);
              return (
                <TR key={m.id} className={m.active ? undefined : "opacity-60"}>
                  <TD>
                    <Link href={`/crm/leads/${m.leadId}`} className="font-medium hover:underline">
                      {m.contactName}
                    </Link>
                    <span className="ml-1.5 font-mono text-xs text-muted-foreground">{m.leadCode}</span>
                  </TD>
                  <TD>{LEAD_OPERATION_LABELS[m.operation]}</TD>
                  <TD>
                    <ScoreBadge score={m.score} />
                  </TD>
                  <TD>
                    <Badge
                      tone={
                        m.status === "interested"
                          ? "success"
                          : m.status === "discarded"
                            ? "danger"
                            : m.status === "sent"
                              ? "primary"
                              : "neutral"
                      }
                    >
                      {MATCH_STATUS_LABELS[m.status]}
                    </Badge>
                    {!m.active && <span className="ml-1 text-xs text-muted-foreground">ya no cumple</span>}
                  </TD>
                  <TD className="text-muted-foreground">{m.agentName ?? "—"}</TD>
                  <TD>
                    {wa && (
                      <a
                        href={wa}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`WhatsApp a ${m.contactName}`}
                        className="text-success"
                      >
                        <MessageCircle className="size-4" />
                      </a>
                    )}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
    </Card>
  );
}
