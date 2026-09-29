import { rentalAlerts } from "@crm/core";
import { getDb } from "@crm/db";
import { ADJUSTMENT_INDEX_LABELS, diffDays } from "@crm/shared/rentals";
import { CalendarClock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { formatDay, price } from "@/components/properties/format";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { requirePagePermission } from "@/lib/session";
import { DEFAULT_TZ, ymdInTz } from "@/lib/tz";

export const metadata: Metadata = { title: "Renovaciones y ajustes" };

function when(today: string, ymd: string) {
  const d = diffDays(today, ymd);
  return d < 0 ? `hace ${-d} días` : d === 0 ? "hoy" : `en ${d} días`;
}

export default async function RenewalsPage() {
  const { ctx } = await requirePagePermission("contract.read");
  const today = ymdInTz(new Date(), ctx.organization.timezone || DEFAULT_TZ);
  const r = await rentalAlerts(getDb(), ctx, today);
  const expiring = r?.expiring ?? [];
  const adjustments = r?.adjustments ?? [];
  return (
    <>
      <PageHeader
        title="Renovaciones y ajustes"
        description="Contratos que vencen en los próximos 90 días y ajustes de los próximos 30. Resolvé cada uno desde la ficha del contrato."
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="border-b px-4 py-3 text-sm font-semibold">Vencimientos · {expiring.length}</h2>
          {expiring.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              className="py-10"
              title="Nada por vencer"
              description="Ningún contrato vence en 90 días."
            />
          ) : (
            <ul className="divide-y text-sm">
              {expiring.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/rentals/contracts/${c.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-muted"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {c.propertyAddress || c.propertyLabel}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {c.code} · {c.tenantName} · {price(c.rentMinor, c.currency)}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <Badge tone={c.endDate < today ? "danger" : "warning"}>
                        {c.endDate < today ? "Vencido" : "Vence"}
                      </Badge>
                      <span className="block text-xs text-muted-foreground">
                        {formatDay(c.endDate)} · {when(today, c.endDate)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <h2 className="border-b px-4 py-3 text-sm font-semibold">Ajustes · {adjustments.length}</h2>
          {adjustments.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              className="py-10"
              title="Sin ajustes próximos"
              description="Ningún ajuste en los próximos 30 días."
            />
          ) : (
            <ul className="divide-y text-sm">
              {adjustments.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/rentals/contracts/${c.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-muted"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {c.propertyAddress || c.propertyLabel}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {c.code} · {ADJUSTMENT_INDEX_LABELS[c.adjustmentIndex]} · hoy{" "}
                        {price(c.rentMinor, c.currency)}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <Badge tone={c.nextAdjustmentAt && c.nextAdjustmentAt < today ? "danger" : "warning"}>
                        {c.nextAdjustmentAt && c.nextAdjustmentAt < today ? "Atrasado" : "Ajuste"}
                      </Badge>
                      <span className="block text-xs text-muted-foreground">
                        {formatDay(c.nextAdjustmentAt)} ·{" "}
                        {c.nextAdjustmentAt ? when(today, c.nextAdjustmentAt) : ""}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
