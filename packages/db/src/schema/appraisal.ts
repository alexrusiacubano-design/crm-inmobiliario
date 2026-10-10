import { sql } from "drizzle-orm";
import { bigint, check, date, index, integer, jsonb, numeric, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { AppraisalComparable } from "@crm/shared/appraisal";
import { createdAt, deletedAt, id, updatedAt } from "./_helpers";
import { user } from "./auth";
import { contact } from "./crm";
import { department, locality, neighborhood } from "./geo";
import { branch, currencyEnum, organization, team } from "./organization";
import {
  acquisition,
  property,
  propertyConditionEnum,
  propertyOperationEnum,
  propertyTypeEnum,
  valuation,
} from "./property";

/**
 * Tasación independiente: se hace sobre un inmueble descrito a mano, sin que exista como
 * propiedad del CRM. Opcionalmente se vincula después a una propiedad o captación.
 */
export const appraisal = pgTable(
  "appraisal",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    code: text("code").notNull(),
    status: text("status").notNull().default("draft"),
    title: text("title"),
    address: text("address"),
    propertyType: propertyTypeEnum("property_type").notNull(),
    operation: propertyOperationEnum("operation").notNull().default("sale"),
    departmentId: integer("department_id").references(() => department.id),
    localityId: integer("locality_id").references(() => locality.id),
    neighborhoodId: integer("neighborhood_id").references(() => neighborhood.id),
    builtArea: numeric("built_area", { precision: 10, scale: 2 }),
    totalArea: numeric("total_area", { precision: 12, scale: 2 }),
    bedrooms: integer("bedrooms"),
    bathrooms: integer("bathrooms"),
    garages: integer("garages"),
    yearBuilt: integer("year_built"),
    condition: propertyConditionEnum("condition"),
    clientName: text("client_name"),
    clientContactId: uuid("client_contact_id").references(() => contact.id),
    currency: currencyEnum("currency").notNull().default("USD"),
    offerDiscountBp: integer("offer_discount_bp").notNull().default(700),
    comparables: jsonb("comparables").$type<AppraisalComparable[]>().notNull().default([]),
    /** Resultado calculado (promedio homogeneizado por m² y valor). */
    unitValueMinor: bigint("unit_value_minor", { mode: "bigint" }),
    estimatedMinor: bigint("estimated_minor", { mode: "bigint" }),
    minMinor: bigint("min_minor", { mode: "bigint" }),
    maxMinor: bigint("max_minor", { mode: "bigint" }),
    /** Valor que adopta el tasador (si difiere del calculado). */
    adoptedMinor: bigint("adopted_minor", { mode: "bigint" }),
    notes: text("notes"),
    valuedAt: date("valued_at").notNull(),
    propertyId: uuid("property_id").references(() => property.id),
    acquisitionId: uuid("acquisition_id").references(() => acquisition.id),
    valuationId: uuid("valuation_id").references(() => valuation.id),
    valuedById: uuid("valued_by_id").references(() => user.id),
    branchId: uuid("branch_id").references(() => branch.id),
    teamId: uuid("team_id").references(() => team.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("appraisal_org_code_idx").on(t.organizationId, t.code),
    index("appraisal_org_date_idx").on(t.organizationId, t.valuedAt.desc()),
    check("appraisal_status_check", sql`${t.status} in ('draft', 'final')`),
  ],
);
