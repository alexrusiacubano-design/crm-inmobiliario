import { hasPermission, listAppraisals } from "@crm/core";
import { getDb } from "@crm/db";
import { formatMoney } from "@crm/shared/money";
import { PROPERTY_OPERATION_LABELS } from "@crm/shared/property";
import { Calculator, Plus, Printer } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Pagination, SearchBox } from "@/components/data/list-controls";
import { formatDay } from "@/components/properties/format";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requirePagePermission } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Historial de tasaciones" };

const fmt = (n: number | null, c: "USD" | "UYU") =>
  n === null
    ? "—"
    : formatMoney({ amountMinor: BigInt(Math.round(n * 100)), currency: c }, { showDecimals: "never" });

export default async function AppraisalHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { ctx } = await requirePagePermission("valuation.read");
  const sp = await searchParams;
  const status = sp.status === "draft" || sp.status === "final" ? sp.status : undefined;
  const list = await listAppraisals(getDb(), ctx, { ...sp, status, pageSize: 25 });
  const canCreate = hasPermission(ctx, "valuation.manage");
  const chip = (active: boolean) =>
    cn(
      "rounded-full border px-3 py-1 text-xs",
      active ? "border-primary bg-primary-soft text-primary" : "text-muted-foreground hover:text-foreground",
    );
  const href = (s?: string) => {
    const q = new URLSearchParams();
    if (s) q.set("status", s);
    if (sp.q) q.set("q", sp.q);
    return `?${q.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Historial de tasaciones"
        description="Todas las tasaciones realizadas, con o sin propiedad publicada."
        actions={
          canCreate && (
            <Button asChild>
              <Link href="/appraisals/new">
                <Plus /> Nueva tasación
              </Link>
            </Button>
          )
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link href={href()} className={chip(!status)}>
          Todas
        </Link>
        <Link href={href("final")} className={chip(status === "final")}>
          Finalizadas
        </Link>
        <Link href={href("draft")} className={chip(status === "draft")}>
          Borradores
        </Link>
        <SearchBox placeholder="Buscar código, título, zona o cliente…" className="ml-auto w-full sm:w-80" />
      </div>
      <Card>
        {list.items.length === 0 ? (
          <EmptyState
            icon={Calculator}
            title="Todavía no hay tasaciones"
            description="Creá una tasación cargando el inmueble y algunos antecedentes del mercado."
          />
        ) : (
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Código</TH>
                <TH>Inmueble</TH>
                <TH>Cliente</TH>
                <TH className="text-right">M²</TH>
                <TH className="text-right">Valor por m²</TH>
                <TH className="text-right">Valor</TH>
                <TH>Fecha</TH>
                <TH>Estado</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {list.items.map((a) => (
                <TR key={a.id}>
                  <TD>
                    <Link
                      href={`/appraisals/${a.id}`}
                      className="font-mono text-xs text-primary hover:underline"
                    >
                      {a.code}
                    </Link>
                  </TD>
                  <TD>
                    <Link href={`/appraisals/${a.id}`} className="hover:underline">
                      {a.title || a.typeLabel}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {[a.typeLabel, PROPERTY_OPERATION_LABELS[a.operation], a.zone]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </TD>
                  <TD className="text-muted-foreground">{a.clientName ?? "—"}</TD>
                  <TD className="text-right tabular">{a.area ?? "—"}</TD>
                  <TD className="text-right tabular">{fmt(a.unitValue, a.currency)}</TD>
                  <TD className="text-right font-semibold tabular">{fmt(a.value, a.currency)}</TD>
                  <TD className="whitespace-nowrap">
                    {formatDay(a.valuedAt)}
                    <span className="block text-xs text-muted-foreground">{a.valuedByName ?? ""}</span>
                  </TD>
                  <TD>
                    <Badge tone={a.status === "final" ? "success" : "neutral"}>
                      {a.status === "final" ? "Finalizada" : "Borrador"}
                    </Badge>
                  </TD>
                  <TD>
                    <Link
                      href={`/print/tasacion/${a.id}`}
                      target="_blank"
                      aria-label="Imprimir informe"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Printer className="size-4" />
                    </Link>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} />
    </>
  );
}
