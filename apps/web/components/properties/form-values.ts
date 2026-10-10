import type { getProperty } from "@crm/core";
import type { PropertyFeature } from "@crm/shared";
import { minorToInput } from "./format";
import type { PropertyFormValues } from "./property-form";

type PropertyData = Awaited<ReturnType<typeof getProperty>>;
const str = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));

/** Valores del formulario de la propiedad a partir de la ficha (edición completa o rápida). */
export function propertyFormValues(data: PropertyData): PropertyFormValues {
  const p = data.property;
  return {
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
}
