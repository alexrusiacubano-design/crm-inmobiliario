import type { AcquisitionFormValues } from "./acquisition-dialog";
import type { PropertyFormValues } from "./property-form";

// Valores iniciales de formularios. Van en un módulo sin "use client" porque las páginas
// (componentes de servidor) los llaman para armar las props.

export function emptyProperty(departmentId = ""): PropertyFormValues {
  return {
    type: "apartment",
    operations: ["sale"],
    title: "",
    description: "",
    departmentId,
    localityId: "",
    neighborhoodId: "",
    address: "",
    unit: "",
    padron: "",
    latitude: "",
    longitude: "",
    bedrooms: "",
    bathrooms: "",
    suites: "",
    garages: "",
    totalArea: "",
    builtArea: "",
    floor: "",
    yearBuilt: "",
    orientation: "",
    condition: "",
    features: [],
    petsAllowed: false,
    furnished: false,
    commissionPercent: "",
    assignedUserId: "",
    internalNotes: "",
    expenses: [],
  };
}

export function emptyAcquisition(departmentId = ""): AcquisitionFormValues {
  return {
    owner: null,
    propertyType: "apartment",
    operation: "sale",
    departmentId,
    localityId: "",
    neighborhoodId: "",
    address: "",
    padron: "",
    latitude: "",
    longitude: "",
    sourcePortal: "",
    portalUrl: "",
    exclusive: false,
    exclusiveFrom: "",
    exclusiveUntil: "",
    commissionPercent: "",
    currency: "USD",
    askingPrice: "",
    recommendedPrice: "",
    publicationAuthorized: false,
    captadorUserId: "",
    notes: "",
  };
}
