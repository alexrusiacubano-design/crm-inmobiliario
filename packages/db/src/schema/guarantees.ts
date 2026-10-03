import { bigint, date, index, jsonb, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import {
  DEPOSIT_PLACES,
  GUARANTEE_STATUSES,
  GUARANTEE_TYPES,
  type GuaranteeRequirement,
} from "@crm/shared/guarantees";
import { createdAt, deletedAt, id, updatedAt } from "./_helpers";
import { user } from "./auth";
import { contact } from "./crm";
import { deal } from "./deals";
import { branch, currencyEnum, organization, team } from "./organization";
import { rentalContract } from "./rentals";

export const guaranteeTypeEnum = pgEnum("guarantee_type", GUARANTEE_TYPES);
export const guaranteeStatusEnum = pgEnum("guarantee_status", GUARANTEE_STATUSES);
export const depositPlaceEnum = pgEnum("deposit_place", DEPOSIT_PLACES);

/** Garantía de un inquilino: en trámite antes del contrato y vigente durante él. */
export const rentalGuarantee = pgTable(
  "rental_guarantee",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    tenantContactId: uuid("tenant_contact_id")
      .notNull()
      .references(() => contact.id),
    contractId: uuid("contract_id").references(() => rentalContract.id),
    dealId: uuid("deal_id").references(() => deal.id),
    type: guaranteeTypeEnum("type").notNull(),
    status: guaranteeStatusEnum("status").notNull().default("in_process"),
    /** Aseguradora, banco u organismo. */
    provider: text("provider"),
    /** N.º de póliza, certificado o solicitud. */
    reference: text("reference"),
    currency: currencyEnum("currency").notNull().default("UYU"),
    coverageMinor: bigint("coverage_minor", { mode: "bigint" }),
    requestedAt: date("requested_at").notNull(),
    validFrom: date("valid_from"),
    validUntil: date("valid_until"),
    depositPlace: depositPlaceEnum("deposit_place"),
    guarantorContactId: uuid("guarantor_contact_id").references(() => contact.id),
    requirements: jsonb("requirements").$type<GuaranteeRequirement[]>().notNull().default([]),
    notes: text("notes"),
    statusNote: text("status_note"),
    assignedUserId: uuid("assigned_user_id")
      .notNull()
      .references(() => user.id),
    branchId: uuid("branch_id").references(() => branch.id),
    teamId: uuid("team_id").references(() => team.id),
    createdById: uuid("created_by_id").references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index("rental_guarantee_org_status_idx").on(t.organizationId, t.status, t.validUntil),
    index("rental_guarantee_contract_idx").on(t.contractId),
    index("rental_guarantee_tenant_idx").on(t.tenantContactId),
  ],
);
