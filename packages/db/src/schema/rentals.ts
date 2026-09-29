import { sql } from "drizzle-orm";
import {
  bigint,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { ADJUSTMENT_INDEXES, CONTRACT_STATUSES, RENT_CHANGE_REASONS } from "@crm/shared/rentals";
import { createdAt, deletedAt, id, updatedAt } from "./_helpers";
import { user } from "./auth";
import { contact } from "./crm";
import { deal } from "./deals";
import { branch, currencyEnum, organization, team } from "./organization";
import { property } from "./property";

export const contractStatusEnum = pgEnum("contract_status", CONTRACT_STATUSES);
export const adjustmentIndexEnum = pgEnum("adjustment_index", ADJUSTMENT_INDEXES);
export const rentChangeReasonEnum = pgEnum("rent_change_reason", RENT_CHANGE_REASONS);

/** Contrato de alquiler. Uno vigente por propiedad; una renovación es un contrato nuevo encadenado. */
export const rentalContract = pgTable(
  "rental_contract",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    /** CTR-000001 */
    code: text("code").notNull(),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => property.id),
    tenantContactId: uuid("tenant_contact_id")
      .notNull()
      .references(() => contact.id),
    dealId: uuid("deal_id").references(() => deal.id),
    renewedFromId: uuid("renewed_from_id").references((): AnyPgColumn => rentalContract.id),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    currency: currencyEnum("currency").notNull(),
    /** Alquiler vigente (el historial está en rental_contract_rent). */
    rentMinor: bigint("rent_minor", { mode: "bigint" }).notNull(),
    paymentDay: integer("payment_day").notNull().default(10),
    adjustmentIndex: adjustmentIndexEnum("adjustment_index").notNull().default("ipc"),
    adjustmentMonths: integer("adjustment_months").notNull().default(12),
    fixedAdjustmentBasisPoints: integer("fixed_adjustment_basis_points"),
    nextAdjustmentAt: date("next_adjustment_at"),
    depositMinor: bigint("deposit_minor", { mode: "bigint" }),
    depositCurrency: currencyEnum("deposit_currency"),
    /** Comisión de administración sobre el alquiler (basis points), para liquidaciones. */
    adminFeeBasisPoints: integer("admin_fee_basis_points"),
    guaranteeNote: text("guarantee_note"),
    status: contractStatusEnum("status").notNull().default("active"),
    closedAt: date("closed_at"),
    closeReason: text("close_reason"),
    notes: text("notes"),
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
    uniqueIndex("rental_contract_org_code_uq").on(t.organizationId, t.code),
    uniqueIndex("rental_contract_one_active_uq")
      .on(t.propertyId)
      .where(sql`${t.status} = 'active' and ${t.deletedAt} is null`),
    index("rental_contract_org_status_idx").on(t.organizationId, t.status, t.endDate),
    index("rental_contract_tenant_idx").on(t.tenantContactId),
  ],
);

/** Historial del alquiler: append-only. */
export const rentalContractRent = pgTable(
  "rental_contract_rent",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => rentalContract.id),
    effectiveFrom: date("effective_from").notNull(),
    currency: currencyEnum("currency").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    reason: rentChangeReasonEnum("reason").notNull(),
    basisPoints: integer("basis_points"),
    note: text("note"),
    actorUserId: uuid("actor_user_id").references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [index("rental_contract_rent_contract_idx").on(t.contractId, t.effectiveFrom)],
);
