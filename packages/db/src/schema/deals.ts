import {
  bigint,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { COMMISSION_SIDES, COMMISSION_STATUSES, DEAL_STAGES, PARTICIPANT_ROLES } from "@crm/shared/deals";
import { createdAt, deletedAt, id, updatedAt } from "./_helpers";
import { user } from "./auth";
import { contact, lead } from "./crm";
import { branch, currencyEnum, organization, team } from "./organization";
import { property, propertyOperationEnum } from "./property";

export const dealStageEnum = pgEnum("deal_stage", DEAL_STAGES);
export const commissionSideEnum = pgEnum("commission_side", COMMISSION_SIDES);
export const commissionStatusEnum = pgEnum("commission_status", COMMISSION_STATUSES);
export const participantRoleEnum = pgEnum("participant_role", PARTICIPANT_ROLES);

/** Operación: una propiedad, un cliente (comprador o inquilino) y un precio acordado. */
export const deal = pgTable(
  "deal",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    code: text("code").notNull(),
    operation: propertyOperationEnum("operation").notNull(),
    stage: dealStageEnum("stage").notNull().default("negotiation"),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => property.id),
    clientContactId: uuid("client_contact_id")
      .notNull()
      .references(() => contact.id),
    leadId: uuid("lead_id").references(() => lead.id),
    currency: currencyEnum("currency").notNull(),
    priceMinor: bigint("price_minor", { mode: "bigint" }).notNull(),
    expectedCloseDate: date("expected_close_date"),
    closedAt: date("closed_at"),
    fallenReason: text("fallen_reason"),
    notes: text("notes"),
    assignedUserId: uuid("assigned_user_id")
      .notNull()
      .references(() => user.id),
    branchId: uuid("branch_id").references(() => branch.id),
    teamId: uuid("team_id").references(() => team.id),
    stageChangedAt: timestamp("stage_changed_at", { withTimezone: true }).notNull().defaultNow(),
    createdById: uuid("created_by_id").references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("deal_org_code_uq").on(t.organizationId, t.code),
    index("deal_org_stage_idx").on(t.organizationId, t.stage),
    index("deal_org_assigned_idx").on(t.organizationId, t.assignedUserId),
    index("deal_property_idx").on(t.propertyId),
  ],
);

/** Honorario que paga cada parte. Se cobra una vez; anular deja rastro. */
export const dealCommission = pgTable(
  "deal_commission",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deal.id, { onDelete: "cascade" }),
    side: commissionSideEnum("side").notNull(),
    currency: currencyEnum("currency").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    status: commissionStatusEnum("status").notNull().default("pending"),
    dueDate: date("due_date"),
    collectedAt: date("collected_at"),
    reference: text("reference"),
    collectedById: uuid("collected_by_id").references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("deal_commission_side_uq").on(t.dealId, t.side),
    index("deal_commission_org_status_idx").on(t.organizationId, t.status),
  ],
);

/**
 * Quién participa y con qué parte de los honorarios de la oficina. `agentRateBasisPoints` es
 * el porcentaje que le corresponde al agente según su escalón al momento de cerrar.
 */
export const dealParticipant = pgTable(
  "deal_participant",
  {
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deal.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    role: participantRoleEnum("role").notNull(),
    shareBasisPoints: integer("share_basis_points").notNull(),
    agentRateBasisPoints: integer("agent_rate_basis_points"),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.dealId, t.userId] }),
    index("deal_participant_user_idx").on(t.organizationId, t.userId),
  ],
);

/** Plan de carrera: escalones por facturación acumulada (en USD) y su porcentaje. */
export const commissionTier = pgTable(
  "commission_tier",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    position: integer("position").notNull(),
    name: text("name").notNull(),
    minBilledUsdMinor: bigint("min_billed_usd_minor", { mode: "bigint" }).notNull(),
    rateBasisPoints: integer("rate_basis_points").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("commission_tier_org_pos_uq").on(t.organizationId, t.position)],
);

/** Tipo de cambio de referencia para sumar pesos a la facturación en dólares. */
export const commissionSettings = pgTable("commission_settings", {
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organization.id),
  uyuPerUsd: numeric("uyu_per_usd", { precision: 10, scale: 4 }).notNull(),
  updatedAt: updatedAt(),
});
