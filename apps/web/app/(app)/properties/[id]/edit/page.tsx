import {
  getProperty,
  hasPermission,
  listAssignees,
  listGeo,
  NotFoundError,
  ValidationError,
} from "@crm/core";
import { getDb } from "@crm/db";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { propertyFormValues } from "@/components/properties/form-values";
import { PropertyForm, type PropertyFormValues } from "@/components/properties/property-form";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Editar propiedad" };

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
  const initial: PropertyFormValues = propertyFormValues(data);

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
