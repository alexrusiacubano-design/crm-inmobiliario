import {
  getProperty,
  hasPermission,
  listAssignees,
  listGeo,
  NotFoundError,
  ValidationError,
} from "@crm/core";
import { getDb } from "@crm/db";
import type { PropertyFeature } from "@crm/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { minorToInput } from "@/components/properties/format";
import { PropertyForm, type PropertyFormValues } from "@/components/properties/property-form";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Editar propiedad" };

const str = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));

export default async function EditPropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requireSession();
  const { id } = await params;
  const db = getDb();
  const data = await getProperty(db, ctx, id).catch((error: unknown) => {
    if (error instanceof NotFoundError || error instanceof ValidationError) notFound();
    throw error;
  });
  if (!data.permissions.update) redirect(`/properties/${id}`);
  const p = data.property;
  const [geo, assignees] = await Promise.all([
    listGeo(db),
    data.permissions.assign && hasPermission(ctx, "lead.assign")
      ? listAssignees(db, ctx)
      : Promise.resolve(undefined),
  ]);
  const initial: PropertyFormValues = {
    type: p.type,
    operations: p.operations,
    title: str(p.title),
    description: str(p.description),
    departmentId: str(p.departmentId),
    localityId: str(p.localityId),
    neighborhoodId: str(p.neighborhoodId),
    address: str(p.address),
    unit: str(p.unit),
    padron: str(p.padron),
    latitude: str(p.latitude),
    longitude: str(p.longitude),
    bedrooms: str(p.bedrooms),
    bathrooms: str(p.bathrooms),
    suites: str(p.suites),
    garages: str(p.garages),
    totalArea: str(p.totalArea).replace(/\.00$/, ""),
    builtArea: str(p.builtArea).replace(/\.00$/, ""),
    floor: str(p.floor),
    yearBuilt: str(p.yearBuilt),
    orientation: str(p.orientation),
    condition: str(p.condition),
    features: p.features as PropertyFeature[],
    petsAllowed: p.petsAllowed,
    furnished: p.furnished,
    commissionPercent: p.commissionBasisPoints === null ? "" : minorToInput(BigInt(p.commissionBasisPoints)),
    assignedUserId: "",
    internalNotes: str(p.internalNotes),
    expenses: data.expenses.map((e) => ({
      kind: e.kind,
      label: str(e.label),
      amount: minorToInput(e.amountMinor),
      currency: e.currency,
      period: e.period,
    })),
  };
  return (
    <div className="mx-auto max-w-4xl">
      <p className="text-xs text-muted-foreground">
        <Link href="/properties" className="hover:underline">
          Propiedades
        </Link>{" "}
        /{" "}
        <Link href={`/properties/${p.id}`} className="font-mono hover:underline">
          {p.code}
        </Link>
      </p>
      <h1 className="mb-5 mt-0.5 text-xl font-semibold tracking-tight">Editar {data.displayTitle}</h1>
      <PropertyForm propertyId={p.id} initial={initial} geo={geo} assignees={assignees} />
    </div>
  );
}
