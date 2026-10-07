import { NotFoundError, portalSettlement } from "@crm/core";
import { getDb, organization } from "@crm/db";
import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SettlementDoc } from "@/components/print/settlement-doc";
import { PrintSheet } from "@/components/print/sheet";
import { requirePortalSession } from "@/lib/session";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Liquidación" };

export default async function PortalPrintSettlement({ params }: { params: Promise<{ code: string }> }) {
  const { pctx } = await requirePortalSession();
  const { code } = await params;
  const db = getDb();
  const [org] = await db.select().from(organization).where(eq(organization.id, pctx.organizationId));
  const s = await portalSettlement(db, pctx, code).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  if (!org) notFound();
  return (
    <PrintSheet
      org={org}
      title="Liquidación"
      number={s.code}
      date={formatDateTime(new Date())}
      back={{ href: "/portal", label: "Mi portal" }}
    >
      <SettlementDoc s={s} onlyContactId={pctx.contactId} />
    </PrintSheet>
  );
}
