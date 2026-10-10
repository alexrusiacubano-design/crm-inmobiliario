import { ForbiddenError, getAppraisal, hasPermission, listGeo, NotFoundError } from "@crm/core";
import { getDb } from "@crm/db";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppraisalEditor } from "@/components/appraisals/appraisal-editor";
import { DeleteAppraisalButton } from "@/components/appraisals/delete-button";
import { PageHeader } from "@/components/ui/misc";
import { requirePagePermission } from "@/lib/session";

export const metadata: Metadata = { title: "Tasación" };

const str = (v: number | string | null | undefined) => (v === null || v === undefined ? "" : String(v));

export default async function AppraisalPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requirePagePermission("valuation.read");
  const { id } = await params;
  const db = getDb();
  const [a, geo] = await Promise.all([
    getAppraisal(db, ctx, id).catch((error: unknown) => {
      if (error instanceof NotFoundError) notFound();
      if (error instanceof ForbiddenError) redirect("/forbidden");
      throw error;
    }),
    listGeo(db),
  ]);
  const canEdit = hasPermission(ctx, "valuation.manage", {
    organizationId: a.organizationId,
    ownerUserId: a.valuedById,
    branchId: a.branchId,
    teamId: a.teamId,
  });
  return (
    <>
      <PageHeader
        title={a.title || `Tasación ${a.code}`}
        description={[a.code, a.typeLabel, a.zone, a.valuedByName ? `por ${a.valuedByName}` : null]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <div className="flex gap-2">
            <Link href="/appraisals/history" className="text-sm text-muted-foreground hover:underline">
              ← Historial
            </Link>
            {canEdit && <DeleteAppraisalButton id={a.id} />}
          </div>
        }
      />
      <AppraisalEditor
        canPrint
        geo={geo}
        initial={{
          id: a.id,
          code: a.code,
          status: a.status as "draft" | "final",
          title: a.title ?? "",
          address: a.address ?? "",
          propertyType: a.propertyType,
          operation: a.operation,
          departmentId: str(a.departmentId),
          localityId: str(a.localityId),
          neighborhoodId: str(a.neighborhoodId),
          builtArea: str(a.builtArea),
          totalArea: str(a.totalArea),
          bedrooms: str(a.bedrooms),
          bathrooms: str(a.bathrooms),
          garages: str(a.garages),
          yearBuilt: str(a.yearBuilt),
          condition: a.condition ?? "",
          clientName: a.clientName ?? "",
          currency: a.currency,
          offerDiscount: str(a.offerDiscountBp / 100),
          comparables: a.comparables,
          adoptedValue: a.adoptedMinor !== null ? str(Number(a.adoptedMinor) / 100) : "",
          notes: a.notes ?? "",
        }}
      />
    </>
  );
}
