import { getOrganization, getSettlement, NotFoundError, ValidationError } from "@crm/core";
import { getDb } from "@crm/db";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SettlementDoc } from "@/components/print/settlement-doc";
import { PrintSheet } from "@/components/print/sheet";
import { requirePagePermission } from "@/lib/session";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Liquidación" };

export default async function PrintSettlement({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requirePagePermission("settlement.read");
  const { id } = await params;
  const db = getDb();
  const [org, s] = await Promise.all([
    getOrganization(db, ctx),
    getSettlement(db, ctx, id).catch((e: unknown) => {
      if (e instanceof NotFoundError || e instanceof ValidationError) notFound();
      throw e;
    }),
  ]);
  return (
    <PrintSheet
      org={org}
      title="Liquidación al propietario"
      number={s.code}
      date={formatDateTime(new Date())}
      back={{ href: "/rentals/settlements", label: "Liquidaciones" }}
    >
      <SettlementDoc s={s} />
    </PrintSheet>
  );
}
