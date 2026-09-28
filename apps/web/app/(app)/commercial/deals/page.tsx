import { hasPermission, listDeals } from "@crm/core";
import { getDb } from "@crm/db";
import { dealStageLabel, OPEN_DEAL_STAGES, PROPERTY_OPERATION_LABELS } from "@crm/shared";
import { Gavel, User } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Pagination, SearchBox } from "@/components/data/list-controls";
import { NewDealButton } from "@/components/deals/new-deal-dialog";
import { formatDay, price } from "@/components/properties/format";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { requirePagePermission } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Operaciones" };

const TABS = [
  { key: "open", label: "Pendientes" },
  { key: "closed", label: "Cerradas" },
  { key: "fallen", label: "Caídas" },
  { key: "all", label: "Todas" },
] as const;

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { ctx } = await requirePagePermission("deal.read");
  const params = await searchParams;
  const status = TABS.some((t) => t.key === params.status) ? params.status : "open";
  const list = await listDeals(getDb(), ctx, { ...params, status });

  const count = (filter: (c: (typeof list.counts)[number]) => boolean) =>
    list.counts.filter(filter).reduce((a, c) => a + c.n, 0);
  const tabCount = {
    open: count((c) => OPEN_DEAL_STAGES.includes(c.stage)),
    closed: count((c) => c.stage === "closed"),
    fallen: count((c) => c.stage === "fallen"),
    all: count(() => true),
  };
  const href = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...params, ...patch, page: undefined })) if (v) next.set(k, v);
    return `?${next.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Operaciones"
        description="Ventas y alquileres en curso: de la negociación a la firma, con honorarios y reparto."
        actions={hasPermission(ctx, "deal.manage") ? <NewDealButton /> : undefined}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <nav aria-label="Estado" className="flex gap-4 border-b text-sm">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={href({ status: t.key })}
              aria-current={status === t.key ? "page" : undefined}
              className={cn(
                "-mb-px border-b-2 py-2",
                status === t.key
                  ? "border-primary font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label} <span className="text-muted-foreground tabular">({tabCount[t.key]})</span>
            </Link>
          ))}
        </nav>
        <nav aria-label="Operación" className="flex rounded-md border p-0.5 text-xs">
          {[
            { k: undefined, l: "Todas" },
            { k: "sale", l: "Ventas" },
            { k: "rent", l: "Alquileres" },
            { k: "temporary_rent", l: "Temporarios" },
          ].map((o) => (
            <Link
              key={o.l}
              href={href({ operation: o.k })}
              className={cn(
                "rounded px-2.5 py-1",
                params.operation === o.k ? "bg-primary text-primary-foreground" : "text-muted-foreground",
              )}
            >
              {o.l}
            </Link>
          ))}
        </nav>
        <Link
          href={href({ mine: params.mine ? undefined : "1" })}
          className={cn(
            "rounded-full border px-3 py-1 text-xs",
            params.mine ? "border-primary bg-primary-soft text-primary" : "text-muted-foreground",
          )}
        >
          Solo donde participo
        </Link>
        <SearchBox placeholder="Código, propiedad o cliente" className="ml-auto max-w-xs" />
      </div>

      {list.items.length === 0 ? (
        <Card>
          <EmptyState
            icon={Gavel}
            title="No hay operaciones acá"
            description="Creá una operación cuando un cliente decide avanzar con una propiedad."
          />
        </Card>
      ) : (
        <div className="grid gap-3">
          {list.items.map((d) => {
            const fees = d.commissions.filter((c) => c.status !== "cancelled");
            return (
              <Link key={d.id} href={`/commercial/deals/${d.id}`} className="group">
                <Card className="flex flex-wrap items-start gap-4 p-4 transition-colors group-hover:border-border-strong">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge
                        tone={d.stage === "closed" ? "success" : d.stage === "fallen" ? "danger" : "warning"}
                      >
                        {dealStageLabel(d.stage, d.operation)}
                      </Badge>
                      <Badge tone="primary">{PROPERTY_OPERATION_LABELS[d.operation]}</Badge>
                      <span className="font-mono text-xs text-muted-foreground">{d.code}</span>
                    </div>
                    <p className="mt-1.5 truncate font-semibold">{d.propertyAddress || d.propertyLabel}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {d.propertyCode} · {d.zone ?? d.propertyLabel}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-primary">
                      {price(d.priceMinor, d.currency)}
                    </p>
                  </div>
                  <div className="w-full rounded-md bg-surface-muted px-3 py-2 text-sm sm:w-64">
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <User className="size-3" aria-hidden />{" "}
                      {d.operation === "sale" ? "Comprador" : "Inquilino"}
                    </p>
                    <p className="truncate font-medium">{d.clientName}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {d.stage === "closed"
                        ? `Firmada ${formatDay(d.closedAt)}`
                        : d.expectedCloseDate
                          ? `Firma estimada ${formatDay(d.expectedCloseDate)}`
                          : `Responsable: ${d.assignedName ?? "—"}`}
                    </p>
                    {fees.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Honorarios: {fees.filter((f) => f.status === "collected").length}/{fees.length}{" "}
                        cobrados
                      </p>
                    )}
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} />
    </>
  );
}
