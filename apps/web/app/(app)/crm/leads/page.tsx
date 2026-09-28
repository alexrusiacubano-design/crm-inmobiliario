import { hasPermission, leadStats, listAssignees, listLeads } from "@crm/core";
import { getDb } from "@crm/db";
import {
  LEAD_OPERATION_LABELS,
  LEAD_SOURCE_LABELS,
  LEAD_STATUS_LABELS,
  LEAD_STATUSES,
  type LeadStatus,
} from "@crm/shared";
import { Inbox } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { LeadStatusBadge } from "@/components/crm/badges";
import { NewLeadButton } from "@/components/crm/lead-dialog";
import { Pagination, SearchBox } from "@/components/data/list-controls";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requirePagePermission } from "@/lib/session";
import { cn, formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Leads" };

function tabHref(params: Record<string, string | undefined>, patch: Record<string, string | undefined>) {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...patch, page: undefined })) if (v) next.set(k, v);
  const s = next.toString();
  return s ? `?${s}` : "?";
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { ctx } = await requirePagePermission("lead.read");
  const params = await searchParams;
  const status = params.status ?? "open";
  const db = getDb();
  const [list, stats, assignees] = await Promise.all([
    listLeads(db, ctx, { ...params, status }),
    leadStats(db, ctx),
    hasPermission(ctx, "lead.assign") ? listAssignees(db, ctx) : Promise.resolve(undefined),
  ]);
  const counts = stats?.byStatus ?? {};
  const openTotal = (
    ["new", "contacted", "qualified", "visit", "offer", "reservation"] as LeadStatus[]
  ).reduce((acc, s) => acc + (counts[s] ?? 0), 0);

  const tabs: { key: string; label: string; n: number }[] = [
    { key: "open", label: "Abiertos", n: openTotal },
    ...LEAD_STATUSES.map((s) => ({ key: s, label: LEAD_STATUS_LABELS[s], n: counts[s] ?? 0 })),
  ];
  const unattended = params.unattended === "1";

  return (
    <>
      <PageHeader
        title="Leads"
        description="Consultas de compra y alquiler en el embudo: Nuevo → Contactado → Calificado → Visita → Oferta → Reserva → Cierre."
        actions={hasPermission(ctx, "lead.create") ? <NewLeadButton assignees={assignees} /> : undefined}
      />

      {(stats?.unattended ?? 0) > 0 && (
        <Link
          href={tabHref(params, {
            unattended: unattended ? undefined : "1",
            status: unattended ? status : "new",
          })}
          className={cn(
            "mb-4 flex items-center justify-between gap-3 rounded-md border px-4 py-2.5 text-sm",
            unattended
              ? "border-primary bg-primary-soft"
              : "border-warning/40 bg-warning-soft hover:border-warning",
          )}
        >
          <span>
            <strong className="tabular">{stats?.unattended}</strong> lead(s) nuevos sin atender: todavía nadie
            registró un contacto con ellos.
          </span>
          <span className="shrink-0 font-medium">{unattended ? "Ver todos" : "Ver solo esos"}</span>
        </Link>
      )}

      <Card>
        <nav aria-label="Etapas" className="flex gap-1 overflow-x-auto border-b px-2">
          {tabs.map((t) => {
            const active = status === t.key;
            return (
              <Link
                key={t.key}
                href={tabHref(params, { status: t.key, unattended: undefined })}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2.5 text-sm",
                  active
                    ? "border-primary font-medium"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
                <span className="rounded bg-surface-muted px-1 text-xs tabular">{t.n}</span>
              </Link>
            );
          })}
        </nav>
        <div className="border-b p-3">
          <SearchBox placeholder="Nombre o código LEAD-…" />
        </div>
        {list.items.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="No hay leads en esta etapa"
            description={params.q ? "Probá con otra búsqueda." : undefined}
          />
        ) : (
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Cliente</TH>
                <TH className="hidden sm:table-cell">Busca</TH>
                <TH>Etapa</TH>
                <TH className="hidden md:table-cell">Origen</TH>
                <TH className="hidden lg:table-cell">Responsable</TH>
                <TH className="hidden md:table-cell">Último contacto</TH>
              </TR>
            </THead>
            <TBody>
              {list.items.map((l) => (
                <TR key={l.id}>
                  <TD className="max-w-0 sm:max-w-none">
                    <Link href={`/crm/leads/${l.id}`} className="font-medium hover:underline">
                      {l.contactName}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-mono">{l.code}</span>
                      {l.phone ? ` · ${l.phone}` : ""}
                    </p>
                  </TD>
                  <TD className="hidden sm:table-cell">{LEAD_OPERATION_LABELS[l.operation]}</TD>
                  <TD>
                    <div className="flex flex-wrap items-center gap-1">
                      <LeadStatusBadge status={l.status} />
                      {l.unattended && <Badge tone="danger">Sin atender</Badge>}
                    </div>
                  </TD>
                  <TD className="hidden text-muted-foreground md:table-cell">
                    {LEAD_SOURCE_LABELS[l.source]}
                  </TD>
                  <TD className="hidden text-muted-foreground lg:table-cell">{l.assignedName ?? "—"}</TD>
                  <TD className="hidden whitespace-nowrap text-muted-foreground md:table-cell">
                    {l.lastContactAt ? formatDateTime(l.lastContactAt) : "—"}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        <Pagination page={list.page} pageSize={list.pageSize} total={list.total} />
      </Card>
    </>
  );
}
