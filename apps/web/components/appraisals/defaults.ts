import type { AppraisalComparable } from "@crm/shared/appraisal";
import type { PropertyType } from "@crm/shared/crm";
import type { PropertyOperation } from "@crm/shared/property";

type Currency = "USD" | "UYU";

export interface AppraisalEditorInitial {
  id?: string;
  code?: string;
  status?: "draft" | "final";
  title: string;
  address: string;
  propertyType: PropertyType;
  operation: PropertyOperation;
  departmentId: string;
  localityId: string;
  neighborhoodId: string;
  builtArea: string;
  totalArea: string;
  bedrooms: string;
  bathrooms: string;
  garages: string;
  yearBuilt: string;
  condition: string;
  clientName: string;
  currency: Currency;
  offerDiscount: string;
  comparables: AppraisalComparable[];
  adoptedValue: string;
  notes: string;
}

export function emptyAppraisal(): AppraisalEditorInitial {
  return {
    title: "",
    address: "",
    propertyType: "apartment",
    operation: "sale",
    departmentId: "",
    localityId: "",
    neighborhoodId: "",
    builtArea: "",
    totalArea: "",
    bedrooms: "",
    bathrooms: "",
    garages: "",
    yearBuilt: "",
    condition: "",
    clientName: "",
    currency: "USD",
    offerDiscount: "7",
    comparables: [],
    adoptedValue: "",
    notes: "",
  };
}
