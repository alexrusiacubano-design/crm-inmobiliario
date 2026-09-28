import { hasPermission, listAssignees, listGeo } from "@crm/core";
import { getDb } from "@crm/db";
import type { Metadata } from "next";
import Link from "next/link";
import { emptyProperty } from "@/components/properties/form-defaults";
import { PropertyForm } from "@/components/properties/property-form";
import { requirePagePermission } from "@/lib/session";

export const metadata: Metadata = { title: "Nueva propiedad" };

export default async function NewPropertyPage() {
  const { ctx } = await requirePagePermission("property.create");
  const db = getDb();
  const [geo, assignees] = await Promise.all([
    listGeo(db),
    hasPermission(ctx, "lead.assign") ? listAssignees(db, ctx) : Promise.resolve(undefined),
  ]);
  const montevideo = geo.departments.find((d) => d.name === "Montevideo");
  return (
    <div className="mx-auto max-w-4xl">
      <p className="text-xs text-muted-foreground">
        <Link href="/properties" className="hover:underline">
          Propiedades
        </Link>{" "}
        /
      </p>
      <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight">Nueva propiedad</h1>
      <p className="mb-5 text-sm text-muted-foreground">
        Se crea en borrador. Después cargás fotos, propietarios y precios, y la publicás cuando la ficha esté
        completa.
      </p>
      <PropertyForm
        initial={emptyProperty(montevideo ? String(montevideo.id) : "")}
        geo={geo}
        assignees={assignees}
      />
    </div>
  );
}
