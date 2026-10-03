import { listSettlements } from "@crm/core";
import { getDb } from "@crm/db";
import { periodLabel, SETTLEMENT_STATUS_LABELS } from "@crm/shared/billing";
import { Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { formatDay, price } from "@/components/properties/format";
import { SettlementActions } from "@/components/rentals/billing-controls";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requirePagePermission } from "@/lib/session";
import { DEFAULT_TZ, ymdInTz } from "@/lib/tz";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Liquidaciones" };

const TABS = [
  { key: "open", label: "Por pagar" },
  { key: "paid", label: "Pagadas" },
  { key: "all", label: "Todas" },
] as const;

function both(v: { UYU: bigint; USD: bigint }) {
  const parts = [v.UYU ? price(v.UYU, "UYU") : null, v.USD ? price(v.USD, "USD") : null].filter(Boolean);
  return parts.length ? parts.join(" + ") : "—";
}

export default async function SettlementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { ctx } = await requirePagePermission("settlement.read");
  const params = await searchParams;
  const status = TABS.some((t) => t.key === params.status)
    ? (params.status as (typeof TABS)[number]["key"])
    : "open";
  const today = ymdInTz(new Date(), ctx.organization.timezone || DEFAULT_TZ);
  const r = await listSettlements(getDb(), ctx, { status });
  const chip = (active: boolean) =>
    cn(
      "rounded-full border px-3 py-1 text-xs",
      active ? "border-primary bg-primary-soft text-primary" : "text-muted-foreground hover:text-foreground",
    );
  return (
    <>
      <PageHeader
        title="Liquidaciones a propietarios"
        description="Se crean desde cada cuota cobrada (Cobros). Borrador → aprobada → pagada; anular deja rastro."
      />
      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Pendiente de pagar a propietarios</p>
          <p className="mt-1 text-xl font-semibold tabular">{both(r.totals.toPay)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Comisiones de administración (en esta vista)</p>
          <p className="mt-1 text-xl font-semibold tabular">{both(r.totals.fees)}</p>
        </Card>
      </div>
      <div className="mb-3 flex gap-2">
        {TABS.map((t) => (
          <Link key={t.key} href={`?status=${t.key}`} className={chip(status === t.key)}>
            {t.label}
          </Link>
        ))}
      </div>
      <Card>
        {r.items.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title="No hay liquidaciones"
            description="Liquidá desde la cuota cobrada en Cobros."
          />
        ) : (
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Liquidación</TH>
                <TH>Período</TH>
                <TH>Propiedad</TH>
                <TH>Propietarios</TH>
                <TH className="text-right">Cobrado</TH>
                <TH className="text-right">Comisión</TH>
                <TH className="text-right">Neto</TH>
                <TH>Estado</TH>
                {r.canManage && <TH />}
              </TR>
            </THead>
            <TBody>
              {r.items.map((s) => (
                <TR key={s.id} className={cn(s.status === "voided" && "opacity-60")}>
                  <TD>
                    <Link
                      href={`/rentals/charges/${s.chargeId}`}
                      className="font-mono text-xs text-primary hover:underline"
                    >
                      {s.code}
                    </Link>
                    <span className="block font-mono text-xs text-muted-foreground">{s.contractCode}</span>
                  </TD>
                  <TD>{periodLabel(s.period)}</TD>
                  <TD>
                    {s.propertyLabel}
                    <span className="block text-xs text-muted-foreground">Inquilino: {s.tenantName}</span>
                  </TD>
                  <TD className="text-muted-foreground">{s.shares.map((x) => x.name).join(", ")}</TD>
                  <TD className="text-right tabular whitespace-nowrap">{price(s.incomeMinor, s.currency)}</TD>
                  <TD className="text-right tabular whitespace-nowrap">{price(s.feeMinor, s.currency)}</TD>
                  <TD className="text-right font-semibold tabular whitespace-nowrap">
                    {price(s.netMinor, s.currency)}
                  </TD>
                  <TD>
                    <Badge
                      tone={s.status === "paid" ? "success" : s.status === "voided" ? "neutral" : "warning"}
                    >
                      {SETTLEMENT_STATUS_LABELS[s.status]}
                    </Badge>
                    {s.paidAt && (
                      <span className="block text-xs text-muted-foreground">{formatDay(s.paidAt)}</span>
                    )}
                  </TD>
                  {r.canManage && (
                    <TD>
                      <SettlementActions id={s.id} status={s.status} today={today} />
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
