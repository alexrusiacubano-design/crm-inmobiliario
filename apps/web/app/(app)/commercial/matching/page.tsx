import { matchableInventoryCount, matchingOverview } from "@crm/core";
import { getDb } from "@crm/db";
import { DEMAND_LEAD_OPERATIONS, LEAD_OPERATION_LABELS, type LeadOperation } from "@crm/shared";
import { MATCH_STATUS_LABELS, MIN_MATCH_SCORE } from "@crm/shared/matching";
import { Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { LeadStatusBadge } from "@/components/crm/badges";
import { ScoreBadge } from "@/components/matching/match-list";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requirePagePermission } from "@/lib/session";
import { cn, formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Matching" };

export default async function MatchingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { ctx } = await requirePagePermission("lead.read");
  const params = await searchParams;
  const operation = (DEMAND_LEAD_OPERATIONS as readonly string[]).includes(params.op ?? "")
    ? (params.op as LeadOperation)
    : undefined;
  const mine = params.mine === "1";
  const db = getDb();
  const [r, inventory] = await Promise.all([
    matchingOverview(db, ctx, { operation, mine }),
    matchableInventoryCount(db, ctx),
  ]);

  const href = (p: { op?: string | undefined; mine?: boolean }) => {
    const q = new URLSearchParams();
    const op = "op" in p ? p.op : operation;
    const m = "mine" in p ? p.mine : mine;
    if (op) q.set("op", op);
    if (m) q.set("mine", "1");
    const s = q.toString();
    return s ? `?${s}` : "?";
  };
  const chip = (active: boolean) =>
    cn(
      "rounded-full border px-3 py-1 text-xs",
      active ? "border-primary bg-primary-soft text-primary" : "text-muted-foreground hover:text-foreground",
    );

  const kpis: [string, number, string][] = [
    ["Leads abiertos", r.totals.leads, `${r.totals.withoutProfile} sin búsqueda cargada`],
    [
      "Con propiedades para ofrecer",
      r.totals.withSuggestions,
      `${r.totals.suggested} sugerencias sin enviar`,
    ],
    ["Les interesa", r.totals.interested, "propiedades marcadas por el cliente"],
    ["Inventario ofrecible", inventory.total, `${inventory.sale} venta · ${inventory.rent} alquiler`],
  ];

  return (
    <>
      <PageHeader
        title="Matching"
        description={`Cruce automático entre lo que busca cada cliente y el inventario. Se sugiere desde ${MIN_MATCH_SCORE} % de compatibilidad; las reglas se ven en cada sugerencia.`}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map(([label, value, hint]) => (
          <Card key={label} className="p-4">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-semibold tabular">{value}</p>
            <p className="text-xs text-muted-foreground">{hint}</p>
          </Card>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link href={href({ op: undefined })} className={chip(!operation)}>
          Todas
        </Link>
        {DEMAND_LEAD_OPERATIONS.map((op) => (
          <Link key={op} href={href({ op })} className={chip(operation === op)}>
            {LEAD_OPERATION_LABELS[op]}
          </Link>
        ))}
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <Link href={href({ mine: !mine })} className={chip(mine)}>
          Solo mis leads
        </Link>
      </div>

      <Card>
        {r.items.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="No hay leads abiertos"
            description="Cuando entren consultas con búsqueda cargada, acá vas a ver qué propiedades ofrecerles."
          />
        ) : (
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Cliente</TH>
                <TH>Busca</TH>
                <TH>Etapa</TH>
                <TH className="text-right">{MATCH_STATUS_LABELS.suggested}s</TH>
                <TH className="text-right">{MATCH_STATUS_LABELS.sent}s</TH>
                <TH className="text-right">Le interesan</TH>
                <TH>Mejor</TH>
                <TH>Agente</TH>
              </TR>
            </THead>
            <TBody>
              {r.items.map((l) => (
                <TR key={l.leadId}>
                  <TD>
                    <Link href={`/crm/leads/${l.leadId}`} className="font-medium hover:underline">
                      {l.contactName}
                    </Link>
                    <span className="ml-1.5 font-mono text-xs text-muted-foreground">{l.code}</span>
                    {l.newestSuggestionAt && Date.now() - l.newestSuggestionAt.getTime() < 7 * 86_400_000 && (
                      <Badge tone="primary" className="ml-1.5" title={formatDateTime(l.newestSuggestionAt)}>
                        Nuevas
                      </Badge>
                    )}
                  </TD>
                  <TD>{LEAD_OPERATION_LABELS[l.operation]}</TD>
                  <TD>
                    <LeadStatusBadge status={l.status} />
                  </TD>
                  {l.hasProfile ? (
                    <>
                      <TD className="text-right font-semibold tabular">{l.suggested || "—"}</TD>
                      <TD className="text-right tabular">{l.sent || "—"}</TD>
                      <TD className="text-right tabular">{l.interested || "—"}</TD>
                      <TD>{l.bestScore !== null ? <ScoreBadge score={l.bestScore} /> : "—"}</TD>
                    </>
                  ) : (
                    <TD colSpan={4}>
                      <Link href={`/crm/leads/${l.leadId}`} className="text-xs text-warning hover:underline">
                        Falta cargar qué busca
                      </Link>
                    </TD>
                  )}
                  <TD className="text-muted-foreground">{l.agentName ?? "Sin responsable"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
