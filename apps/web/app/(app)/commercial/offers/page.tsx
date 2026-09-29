import { listOffers } from "@crm/core";
import { getDb } from "@crm/db";
import { HandCoins } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { OffersTable } from "@/components/deals/offers-table";
import { Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { requirePagePermission } from "@/lib/session";
import { DEFAULT_TZ, ymdInTz } from "@/lib/tz";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Ofertas" };

export default async function OffersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { ctx } = await requirePagePermission("offer.read");
  const params = await searchParams;
  const status = params.status === "all" ? "all" : "pending";
  const today = ymdInTz(new Date(), ctx.organization.timezone || DEFAULT_TZ);
  const rows = await listOffers(getDb(), ctx, { status });
  const chip = (active: boolean) =>
    cn(
      "rounded-full border px-3 py-1 text-xs",
      active ? "border-primary bg-primary-soft text-primary" : "text-muted-foreground hover:text-foreground",
    );
  return (
    <>
      <PageHeader
        title="Ofertas"
        description="Ofertas y contraofertas de las operaciones en negociación. Se responden desde la ficha de cada operación."
      />
      <div className="mb-3 flex gap-2">
        <Link href="?status=pending" className={chip(status === "pending")}>
          Sin responder
        </Link>
        <Link href="?status=all" className={chip(status === "all")}>
          Todas
        </Link>
      </div>
      <Card>
        {rows.length === 0 ? (
          <EmptyState
            icon={HandCoins}
            title={status === "pending" ? "No hay ofertas sin responder" : "Todavía no hay ofertas"}
            description="Las ofertas se cargan desde una operación en negociación (Comercial → Operaciones)."
          />
        ) : (
          <OffersTable rows={rows} today={today} />
        )}
      </Card>
    </>
  );
}
