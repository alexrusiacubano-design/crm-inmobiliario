import { listCharges } from "@crm/core";
import { getDb } from "@crm/db";
import { addPeriod, periodLabel } from "@crm/shared/billing";
import { capitalizeFirst } from "@/lib/tz";
import { ChevronLeft, ChevronRight, Coins } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { formatDay, price } from "@/components/properties/format";
import { GenerateChargesButton } from "@/components/rentals/billing-controls";
import { ChargeStatusBadge } from "@/components/rentals/charge-badge";
import { Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requirePagePermission } from "@/lib/session";
import { DEFAULT_TZ, ymdInTz } from "@/lib/tz";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Cobros" };

const TABS = [
  { key: "all", label: "Todas" },
  { key: "open", label: "Con saldo" },
  { key: "overdue", label: "Vencidas" },
  { key: "paid", label: "Pagadas" },
] as const;

function both(v: { UYU: bigint; USD: bigint }) {
  const parts = [v.UYU ? price(v.UYU, "UYU") : null, v.USD ? price(v.USD, "USD") : null].filter(Boolean);
  return parts.length ? parts.join(" + ") : "—";
}

export default async function ChargesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { ctx } = await requirePagePermission("rent.read");
  const params = await searchParams;
  const today = ymdInTz(new Date(), ctx.organization.timezone || DEFAULT_TZ);
  const period = /^\d{4}-\d{2}$/.test(params.period ?? "")
    ? `${params.period}-01`
    : `${today.slice(0, 7)}-01`;
  const status = TABS.some((t) => t.key === params.status)
    ? (params.status as (typeof TABS)[number]["key"])
    : "all";
  const r = await listCharges(getDb(), ctx, { period, status }, today);
  const label = periodLabel(period);
  const chip = (active: boolean) =>
    cn(
      "rounded-full border px-3 py-1 text-xs",
      active ? "border-primary bg-primary-soft text-primary" : "text-muted-foreground hover:text-foreground",
    );
  const link = (p: string, s = status) => `?period=${p.slice(0, 7)}&status=${s}`;

  return (
    <>
      <PageHeader
        title="Cobros de alquiler"
        description="Cuotas mensuales por contrato, pagos parciales y morosidad. Generá las cuotas del mes y registrá cada pago."
        actions={r.permissions.generate ? <GenerateChargesButton period={period} label={label} /> : undefined}
      />
      <div className="mb-4 flex items-center gap-2">
        <Link
          href={link(addPeriod(period, -1))}
          className="rounded-md border p-1.5 hover:bg-surface-muted"
          aria-label="Mes anterior"
        >
          <ChevronLeft className="size-4" />
        </Link>
        <span className="min-w-36 text-center text-sm font-semibold">{capitalizeFirst(label)}</span>
        <Link
          href={link(addPeriod(period, 1))}
          className="rounded-md border p-1.5 hover:bg-surface-muted"
          aria-label="Mes siguiente"
        >
          <ChevronRight className="size-4" />
        </Link>
      </div>
      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        {(
          [
            ["A cobrar en el mes", both(r.totals.due), `${r.totals.count} cuota(s)`, false],
            ["Cobrado", both(r.totals.collected), "pagos registrados", false],
            ["Saldo pendiente", both(r.totals.outstanding), "del mes", false],
            [
              "Morosidad",
              both(r.totals.overdue),
              `${r.totals.overdueCount} cuota(s) vencida(s)`,
              r.totals.overdueCount > 0,
            ],
          ] as const
        ).map(([k, v, hint, warn]) => (
          <Card key={k} className={cn("p-4", warn && "border-danger/50 bg-danger-soft/30")}>
            <p className="text-xs text-muted-foreground">{k}</p>
            <p className="mt-1 text-lg font-semibold tabular">{v}</p>
            <p className="text-xs text-muted-foreground">{hint}</p>
          </Card>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link key={t.key} href={link(period, t.key)} className={chip(status === t.key)}>
            {t.label}
          </Link>
        ))}
      </div>
      <Card>
        {r.items.length === 0 ? (
          <EmptyState
            icon={Coins}
            title={`Sin cuotas en ${label}`}
            description={
              r.permissions.generate
                ? "Usá “Generar cuotas” para crear las de los contratos vigentes."
                : undefined
            }
          />
        ) : (
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Contrato</TH>
                <TH>Propiedad</TH>
                <TH>Inquilino</TH>
                <TH>Vence</TH>
                <TH className="text-right">Total</TH>
                <TH className="text-right">Cobrado</TH>
                <TH className="text-right">Saldo</TH>
                <TH>Estado</TH>
              </TR>
            </THead>
            <TBody>
              {r.items.map((c) => (
                <TR key={c.id}>
                  <TD>
                    <Link
                      href={`/rentals/charges/${c.id}`}
                      className="font-mono text-xs text-primary hover:underline"
                    >
                      {c.contractCode}
                    </Link>
                  </TD>
                  <TD>{c.propertyLabel}</TD>
                  <TD>{c.tenantName}</TD>
                  <TD>{formatDay(c.dueDate)}</TD>
                  <TD className="text-right tabular whitespace-nowrap">{price(c.totalMinor, c.currency)}</TD>
                  <TD className="text-right tabular whitespace-nowrap">{price(c.paidMinor, c.currency)}</TD>
                  <TD
                    className={cn(
                      "text-right font-semibold tabular whitespace-nowrap",
                      c.balanceMinor > 0n && c.status === "overdue" && "text-danger",
                    )}
                  >
                    {price(c.balanceMinor, c.currency)}
                  </TD>
                  <TD>
                    <span className="flex flex-wrap gap-1">
                      <ChargeStatusBadge status={c.status} daysLate={c.daysLate} />
                      {c.settlementStatus && <span className="text-xs text-muted-foreground">liquidada</span>}
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
