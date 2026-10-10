import { comparablesFromProperties, listGeo } from "@crm/core";
import { getDb } from "@crm/db";
import type { PropertyType } from "@crm/shared/crm";
import type { PropertyOperation } from "@crm/shared/property";
import type { Metadata } from "next";
import { AppraisalEditor } from "@/components/appraisals/appraisal-editor";
import { emptyAppraisal } from "@/components/appraisals/defaults";
import { PageHeader } from "@/components/ui/misc";
import { requirePagePermission } from "@/lib/session";

export const metadata: Metadata = { title: "Nueva tasación" };

export default async function NewAppraisalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { ctx } = await requirePagePermission("valuation.manage");
  const sp = await searchParams;
  const db = getDb();
  const initial = emptyAppraisal();
  // Desde el comparador: ?codes=PROP-1,PROP-2 con los mismos filtros de la búsqueda.
  if (sp.codes) {
    initial.comparables = await comparablesFromProperties(db, ctx, sp.codes.split(","), sp).catch(() => []);
    if (sp.operation) initial.operation = sp.operation as PropertyOperation;
    if (sp.propertyType) initial.propertyType = sp.propertyType as PropertyType;
    if (sp.currency === "UYU") initial.currency = "UYU";
    initial.departmentId = sp.departmentId ?? "";
    initial.localityId = sp.localityId ?? "";
    initial.neighborhoodId = sp.neighborhoodId ?? "";
  }
  const geo = await listGeo(db);
  return (
    <>
      <PageHeader
        title="Nueva tasación"
        description="Ingresá el inmueble y los antecedentes del mercado para obtener un valor fundamentado (método de comparables homogeneizados)."
      />
      <AppraisalEditor initial={initial} geo={geo} />
    </>
  );
}
