import { hasPermission, listContracts } from "@crm/core";
import { getDb } from "@crm/db";
import { FileSignature } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { formatDay, price } from "@/components/properties/format";
import { ContractAlertBadges, ContractStatusBadge } from "@/components/rentals/badges";
import { NewContractButton } from "@/components/rentals/new-contract-dialog";
import { Input } from "@/components/ui/form";
import { Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requirePagePermission } from "@/lib/session";
import { DEFAULT_TZ, ymdInTz } from "@/lib/tz";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Contratos" };

const TABS = [
  { key: "active", label: "Vigentes" },
  { key: "expiring", label: "Con avisos" },
  { key: "closed", label: "Cerrados" },
  { key: "all", label: "Todos" },
] as const;

export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { ctx } = await requirePagePermission("contract.read");
  const params = await searchParams;
  const status = TABS.some((t) => t.key === params.status)
    ? (params.status as (typeof TABS)[number]["key"])
    : "active";
  const today = ymdInTz(new Date(), ctx.organization.timezone || DEFAULT_TZ);
  const r = await listContracts(getDb(), ctx, { status, q: params.q ?? "" }, today);
  const chip = (active: boolean) =>
    cn(
      "rounded-full border px-3 py-1 text-xs",
      active ? "border-primary bg-primary-soft text-primary" : "text-muted-foreground hover:text-foreground",
    );

  return (
    <>
      <PageHeader
        title="Contratos de alquiler"
        description="Plazos, alquiler vigente, ajustes y renovaciones."
        actions={hasPermission(ctx, "contract.manage") ? <NewContractButton /> : undefined}
      />
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        {(
          [
            ["Vigentes", r.counts.active, "contratos activos"],
            ["Vencen en 90 días", r.counts.expiring, "incluye vencidos sin cerrar"],
            ["Ajustes en 30 días", r.counts.adjustments, "incluye atrasados"],
          ] as const
        ).map(([label, value, hint], i) => (
          <Card
            key={label}
            className={cn("p-4", i > 0 && value > 0 && "border-warning/60 bg-warning-soft/40")}
          >
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-semibold tabular">{value}</p>
            <p className="text-xs text-muted-foreground">{hint}</p>
          </Card>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <Link key={t.key} href={`?status=${t.key}`} className={chip(status === t.key)}>
            {t.label}
          </Link>
        ))}
        <form className="ml-auto w-64">
          <input type="hidden" name="status" value={status} />
          <Input name="q" defaultValue={params.q ?? ""} placeholder="Buscar código, dirección, inquilino…" />
        </form>
      </div>
      <Card>
        {r.items.length === 0 ? (
          <EmptyState
            icon={FileSignature}
            title="No hay contratos"
            description="Creá el contrato desde una operación de alquiler firmada o con “Nuevo contrato”."
          />
        ) : (
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Contrato</TH>
                <TH>Propiedad</TH>
                <TH>Inquilino</TH>
                <TH>Propietario</TH>
                <TH className="text-right">Alquiler</TH>
                <TH>Plazo</TH>
                <TH>Próximo ajuste</TH>
                <TH>Estado</TH>
              </TR>
            </THead>
            <TBody>
              {r.items.map((c) => (
                <TR key={c.id}>
                  <TD>
                    <Link
                      href={`/rentals/contracts/${c.id}`}
                      className="font-mono text-xs text-primary hover:underline"
                    >
                      {c.code}
                    </Link>
                  </TD>
                  <TD>
                    <span className="block">{c.propertyAddress || c.propertyLabel}</span>
                    <span className="block text-xs text-muted-foreground">{c.zone ?? c.propertyCode}</span>
                  </TD>
                  <TD>{c.tenantName}</TD>
                  <TD className="text-muted-foreground">{c.ownerNames.join(", ") || "—"}</TD>
                  <TD className="text-right font-semibold tabular">{price(c.rentMinor, c.currency)}</TD>
                  <TD className="whitespace-nowrap">
                    {formatDay(c.startDate)} → {formatDay(c.endDate)}
                  </TD>
                  <TD>{formatDay(c.nextAdjustmentAt)}</TD>
                  <TD>
                    <span className="flex flex-wrap gap-1">
                      <ContractStatusBadge status={c.status} />
                      <ContractAlertBadges alerts={c.alerts} />
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
