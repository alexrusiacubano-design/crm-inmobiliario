import { contractsWithoutGuarantee, listGuarantees } from "@crm/core";
import { getDb } from "@crm/db";
import {
  GUARANTEE_ALERT_LABELS,
  GUARANTEE_STATUS_LABELS,
  GUARANTEE_TYPE_SHORT,
  GUARANTEE_TYPES,
  type GuaranteeType,
} from "@crm/shared/guarantees";
import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { formatDay, price } from "@/components/properties/format";
import { GuaranteeDialog } from "@/components/rentals/guarantees-panel";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requirePagePermission } from "@/lib/session";
import { DEFAULT_TZ, ymdInTz } from "@/lib/tz";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Garantías" };

const TABS = [
  { key: "alerts", label: "Requieren atención" },
  { key: "in_process", label: "En trámite" },
  { key: "active", label: "Vigentes" },
  { key: "closed", label: "Cerradas" },
  { key: "all", label: "Todas" },
] as const;

export default async function GuaranteesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { ctx } = await requirePagePermission("guarantee.read");
  const params = await searchParams;
  const status = TABS.some((t) => t.key === params.status)
    ? (params.status as (typeof TABS)[number]["key"])
    : "alerts";
  const type = GUARANTEE_TYPES.includes(params.type as GuaranteeType) ? (params.type as GuaranteeType) : null;
  const today = ymdInTz(new Date(), ctx.organization.timezone || DEFAULT_TZ);
  const db = getDb();
  const [r, uncovered] = await Promise.all([
    listGuarantees(db, ctx, { status, type }, today),
    contractsWithoutGuarantee(db, ctx),
  ]);
  const chip = (active: boolean) =>
    cn(
      "rounded-full border px-3 py-1 text-xs",
      active ? "border-primary bg-primary-soft text-primary" : "text-muted-foreground hover:text-foreground",
    );
  const qs = (p: Record<string, string | null>) => {
    const q = new URLSearchParams();
    const next = { status, type, ...p };
    for (const [k, v] of Object.entries(next)) if (v) q.set(k, v);
    return `?${q.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Garantías"
        description="ANDA, CGN, MVOT, seguros de fianza, depósitos y garantía propietaria: requisitos, trámite y vencimientos."
        actions={r.canManage ? <GuaranteeDialog /> : undefined}
      />
      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        {(
          [
            ["En trámite", r.counts.inProcess, "pedidas o aprobadas sin activar", false],
            ["Vigentes", r.counts.active, "cubriendo contratos", false],
            ["Vencen en 60 días", r.counts.expiring, "incluye vencidas", r.counts.expiring > 0],
            ["Contratos sin garantía vigente", uncovered.length, "contratos activos", uncovered.length > 0],
          ] as const
        ).map(([label, value, hint, warn]) => (
          <Card key={label} className={cn("p-4", warn && "border-warning/60 bg-warning-soft/40")}>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-semibold tabular">{value}</p>
            <p className="text-xs text-muted-foreground">{hint}</p>
          </Card>
        ))}
      </div>
      {uncovered.length > 0 && (
        <p className="mb-4 rounded-md border border-warning/50 bg-warning-soft/40 px-4 py-2 text-sm">
          Sin garantía vigente:{" "}
          {uncovered.map((c, i) => (
            <span key={c.id}>
              {i > 0 && ", "}
              <Link href={`/rentals/contracts/${c.id}`} className="text-primary hover:underline">
                {c.code} ({c.tenantName})
              </Link>
            </span>
          ))}
        </p>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <Link key={t.key} href={qs({ status: t.key })} className={chip(status === t.key)}>
            {t.label}
          </Link>
        ))}
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <Link href={qs({ type: null })} className={chip(!type)}>
          Todos los tipos
        </Link>
        {GUARANTEE_TYPES.map((t) => (
          <Link key={t} href={qs({ type: t })} className={chip(type === t)}>
            {GUARANTEE_TYPE_SHORT[t]}
          </Link>
        ))}
      </div>
      <Card>
        {r.items.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="No hay garantías en esta vista"
            description="Cargalas desde el contrato o con “Nueva garantía”."
          />
        ) : (
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Tipo</TH>
                <TH>Inquilino</TH>
                <TH>Contrato</TH>
                <TH>Entidad / N.º</TH>
                <TH className="text-right">Cobertura</TH>
                <TH>Vence</TH>
                <TH>Estado</TH>
              </TR>
            </THead>
            <TBody>
              {r.items.map((g) => (
                <TR key={g.id}>
                  <TD className="font-medium">{GUARANTEE_TYPE_SHORT[g.type]}</TD>
                  <TD>
                    <Link href={`/crm/contacts/${g.tenantContactId}`} className="hover:underline">
                      {g.tenantName}
                    </Link>
                    {g.guarantorName && (
                      <span className="block text-xs text-muted-foreground">Fiador: {g.guarantorName}</span>
                    )}
                  </TD>
                  <TD>
                    {g.contractId ? (
                      <Link
                        href={`/rentals/contracts/${g.contractId}`}
                        className="font-mono text-xs text-primary hover:underline"
                      >
                        {g.contractCode}
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-foreground">Sin contrato</span>
                    )}
                    {g.propertyLabel && (
                      <span className="block text-xs text-muted-foreground">{g.propertyLabel}</span>
                    )}
                  </TD>
                  <TD>
                    {g.provider ?? "—"}
                    {g.reference && (
                      <span className="block text-xs text-muted-foreground">N.º {g.reference}</span>
                    )}
                  </TD>
                  <TD className="text-right tabular">
                    {g.coverageMinor ? price(g.coverageMinor, g.currency) : "—"}
                  </TD>
                  <TD>{formatDay(g.validUntil)}</TD>
                  <TD>
                    <span className="flex flex-wrap gap-1">
                      <Badge
                        tone={
                          g.status === "active"
                            ? "success"
                            : g.status === "rejected" || g.status === "expired"
                              ? "danger"
                              : g.status === "released"
                                ? "neutral"
                                : "warning"
                        }
                      >
                        {GUARANTEE_STATUS_LABELS[g.status]}
                      </Badge>
                      {g.alerts.map((a) => (
                        <Badge key={a} tone={a === "expired" ? "danger" : "warning"}>
                          {GUARANTEE_ALERT_LABELS[a]}
                        </Badge>
                      ))}
                      {g.shortOfContract && <Badge tone="warning">No cubre el plazo</Badge>}
                    </span>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
