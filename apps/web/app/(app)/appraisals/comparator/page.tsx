import { hasPermission, listGeo, marketComparator } from "@crm/core";
import { getDb } from "@crm/db";
import type { Metadata } from "next";
import {
  ComparatorFiltersForm,
  ComparatorResults,
  type ComparatorFilters,
} from "@/components/appraisals/comparator";
import { PageHeader } from "@/components/ui/misc";
import { requirePagePermission } from "@/lib/session";

export const metadata: Metadata = { title: "Comparador de mercado" };

export default async function ComparatorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { ctx } = await requirePagePermission("property.read");
  const sp = await searchParams;
  const db = getDb();
  const [market, geo] = await Promise.all([marketComparator(db, ctx, sp), listGeo(db)]);
  const q = market.query;
  const filters: ComparatorFilters = {
    operation: q.operation,
    propertyType: q.propertyType ?? "",
    departmentId: q.departmentId?.toString() ?? "",
    localityId: q.localityId?.toString() ?? "",
    neighborhoodId: q.neighborhoodId?.toString() ?? "",
    minArea: q.minArea?.toString() ?? "",
    maxArea: q.maxArea?.toString() ?? "",
    bedrooms: q.bedrooms?.toString() ?? "",
    currency: q.currency,
  };
  return (
    <>
      <PageHeader
        title="Comparador de mercado"
        description="Valor por m² en la zona según las propiedades publicadas y las operaciones cerradas del CRM."
      />
      <ComparatorFiltersForm initial={filters} geo={geo} />
      <ComparatorResults
        rows={market.rows}
        stats={market.stats}
        filters={filters}
        rate={market.rate}
        canAppraise={hasPermission(ctx, "valuation.manage")}
      />
    </>
  );
}
