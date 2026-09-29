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
  const r = await listReservations(getDb(), ctx, { status, today });
  const chip = (active: boolean) =>
    cn(
      "rounded-full border px-3 py-1 text-xs",
      active ? "border-primary bg-primary-soft text-primary" : "text-muted-foreground hover:text-foreground",
    );
  const heldText = (h: (typeof DEPOSIT_HOLDERS)[number]) => {
    const v = r.held[h];
    if (!v) return "—";
    return (
      [v.USD ? price(v.USD, "USD") : null, v.UYU ? price(v.UYU, "UYU") : null].filter(Boolean).join(" + ") ||
      "—"
    );
  };

  return (
    <>
      <PageHeader
        title="Reservas"
        description="Señas cobradas, quién las tiene y hasta cuándo valen. Se registran desde la ficha de la operación."
      />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className={cn("p-4", r.expiringCount > 0 && "border-warning/60 bg-warning-soft/40")}>
          <p className="text-xs text-muted-foreground">Vigentes</p>
          <p className="mt-1 text-2xl font-semibold tabular">{r.activeCount}</p>
          <p className="text-xs text-muted-foreground">{r.expiringCount} vencen en 7 días o ya vencieron</p>
        </Card>
        {DEPOSIT_HOLDERS.map((h) => (
          <Card key={h} className="p-4">
            <p className="text-xs text-muted-foreground">Señas en {DEPOSIT_HOLDER_LABELS[h].toLowerCase()}</p>
            <p className="mt-1 text-lg font-semibold tabular">{heldText(h)}</p>
          </Card>
        ))}
      </div>
      <div className="mb-3 flex gap-2">
        <Link href="?status=active" className={chip(status === "active")}>
          Vigentes
        </Link>
        <Link href="?status=closed" className={chip(status === "closed")}>
          Cerradas
        </Link>
        <Link href="?status=all" className={chip(status === "all")}>
          Todas
        </Link>
      </div>
      <Card>
        {r.items.length === 0 ? (
          <EmptyState
            icon={Lock}
            title="No hay reservas"
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
              {r.items.map((x) => {
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
                    <TD className="text-right font-semibold tabular">
                      {price(x.depositMinor, x.currency)}
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
