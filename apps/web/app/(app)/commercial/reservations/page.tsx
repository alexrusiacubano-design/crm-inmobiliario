import { listReservations } from "@crm/core";
import { getDb } from "@crm/db";
import {
  daysBetween,
  DEPOSIT_HOLDER_LABELS,
  DEPOSIT_HOLDERS,
  RESERVATION_STATUS_LABELS,
} from "@crm/shared/offers";
import { dealStageLabel } from "@crm/shared";
import { Lock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { formatDay, price } from "@/components/properties/format";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requirePagePermission } from "@/lib/session";
import { DEFAULT_TZ, ymdInTz } from "@/lib/tz";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Reservas" };

export default async function ReservationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { ctx } = await requirePagePermission("reservation.read");
  const params = await searchParams;
  const status = params.status === "closed" ? "closed" : params.status === "all" ? "all" : "active";
  const today = ymdInTz(new Date(), ctx.organization.timezone || DEFAULT_TZ);
  const moneda = params.moneda === "USD" || params.moneda === "UYU" ? params.moneda : null;
  const r = await listReservations(getDb(), ctx, { status, today });
  const items = moneda ? r.items.filter((x) => x.currency === moneda) : r.items;
  const qs = (next: { status?: string; moneda?: string | null }) => {
    const q = new URLSearchParams();
    q.set("status", next.status ?? status);
    const m = next.moneda === undefined ? moneda : next.moneda;
    if (m) q.set("moneda", m);
    return `?${q.toString()}`;
  };
  const chip = (active: boolean) =>
    cn(
      "rounded-full border px-3 py-1 text-xs",
      active ? "border-primary bg-primary-soft text-primary" : "text-muted-foreground hover:text-foreground",
    );
  // Cada moneda se suma por separado: nunca se mezclan dólares con pesos.
  const currencies = [
    { code: "USD" as const, title: "Señas en dólares (U$S)" },
    { code: "UYU" as const, title: "Señas en pesos ($)" },
  ];
  const totalFor = (c: "USD" | "UYU") => DEPOSIT_HOLDERS.reduce((sum, h) => sum + (r.held[h]?.[c] ?? 0n), 0n);
  const countFor = (c: "USD" | "UYU") => r.activeByCurrency[c];

  return (
    <>
      <PageHeader
        title="Reservas"
        description="Señas cobradas, quién las tiene y hasta cuándo valen. Se registran desde la ficha de la operación."
      />
      <div className="mb-5 grid gap-3 md:grid-cols-[minmax(0,0.8fr)_1fr_1fr]">
        <Card className={cn("p-4", r.expiringCount > 0 && "border-warning/60 bg-warning-soft/40")}>
          <p className="text-xs text-muted-foreground">Vigentes</p>
          <p className="mt-1 text-2xl font-semibold tabular">{r.activeCount}</p>
          <p className="text-xs text-muted-foreground">{r.expiringCount} vencen en 7 días o ya vencieron</p>
        </Card>
        {currencies.map((c) => {
          const total = totalFor(c.code);
          return (
            <Card key={c.code} className="p-4">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-xs text-muted-foreground">{c.title}</p>
                <span className="text-xs text-muted-foreground">
                  {countFor(c.code)} {countFor(c.code) === 1 ? "reserva" : "reservas"}
                </span>
              </div>
              <p className="mt-1 text-2xl font-semibold tabular">{total > 0n ? price(total, c.code) : "—"}</p>
              <dl className="mt-3 space-y-1 border-t pt-2 text-sm">
                {DEPOSIT_HOLDERS.map((h) => {
                  const v = r.held[h]?.[c.code] ?? 0n;
                  return (
                    <div key={h} className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">En {DEPOSIT_HOLDER_LABELS[h].toLowerCase()}</dt>
                      <dd className="font-medium tabular">{v > 0n ? price(v, c.code) : "—"}</dd>
                    </div>
                  );
                })}
              </dl>
            </Card>
          );
        })}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link href={qs({ status: "active" })} className={chip(status === "active")}>
          Vigentes
        </Link>
        <Link href={qs({ status: "closed" })} className={chip(status === "closed")}>
          Cerradas
        </Link>
        <Link href={qs({ status: "all" })} className={chip(status === "all")}>
          Todas
        </Link>
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <Link href={qs({ moneda: null })} className={chip(!moneda)}>
          Ambas monedas
        </Link>
        <Link href={qs({ moneda: "USD" })} className={chip(moneda === "USD")}>
          Dólares
        </Link>
        <Link href={qs({ moneda: "UYU" })} className={chip(moneda === "UYU")}>
          Pesos
        </Link>
      </div>
      <Card>
        {items.length === 0 ? (
          <EmptyState
            icon={Lock}
            title={
              moneda ? `No hay reservas en ${moneda === "USD" ? "dólares" : "pesos"}` : "No hay reservas"
            }
            description="Cuando se acepte una oferta, registrá la reserva desde la operación."
          />
        ) : (
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Operación</TH>
                <TH>Propiedad</TH>
                <TH>Cliente</TH>
                <TH className="text-right">Seña</TH>
                <TH>La tiene</TH>
                <TH>Vence</TH>
                <TH>Estado</TH>
                <TH>Agente</TH>
              </TR>
            </THead>
            <TBody>
              {items.map((x) => {
                const days = daysBetween(today, x.expiresAt);
                const active = x.status === "active";
                return (
                  <TR key={x.id}>
                    <TD>
                      <Link
                        href={`/commercial/deals/${x.dealId}`}
                        className="font-mono text-xs text-primary hover:underline"
                      >
                        {x.dealCode}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {dealStageLabel(x.dealStage, x.operation)}
                      </span>
                    </TD>
                    <TD>
                      <Link href={`/properties/${x.propertyId}`} className="hover:underline">
                        {x.propertyLabel}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        Precio {price(x.priceMinor, x.priceCurrency)}
                      </span>
                    </TD>
                    <TD>{x.clientName}</TD>
                    <TD className="text-right font-semibold tabular whitespace-nowrap">
                      {x.depositMinor > 0n ? (
                        price(x.depositMinor, x.currency)
                      ) : (
                        <span className="font-normal text-muted-foreground">Sin seña</span>
                      )}
                      {x.receiptNumber && (
                        <span className="block text-xs font-normal text-muted-foreground">
                          Recibo {x.receiptNumber}
                        </span>
                      )}
                    </TD>
                    <TD>{x.holderLabel}</TD>
                    <TD>
                      {formatDay(x.expiresAt)}
                      {active && (
                        <Badge
                          tone={days < 0 ? "danger" : days <= 7 ? "warning" : "outline"}
                          className="ml-1.5"
                        >
                          {days < 0 ? "vencida" : days === 0 ? "hoy" : `${days} d`}
                        </Badge>
                      )}
                    </TD>
                    <TD>
                      <Badge tone={active ? "success" : x.status === "converted" ? "primary" : "neutral"}>
                        {RESERVATION_STATUS_LABELS[x.status]}
                      </Badge>
                    </TD>
                    <TD className="text-muted-foreground">{x.agentName ?? "—"}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
