import { sql } from "drizzle-orm";
import {
  bigint,
  date,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { CHARGE_LINE_KINDS, PAYMENT_METHODS, SETTLEMENT_STATUSES } from "@crm/shared/billing";
import { createdAt, id, updatedAt } from "./_helpers";
import { user } from "./auth";
import { currencyEnum, organization } from "./organization";
import { rentalContract } from "./rentals";

export const chargeLineKindEnum = pgEnum("charge_line_kind", CHARGE_LINE_KINDS);
export const paymentMethodEnum = pgEnum("payment_method", PAYMENT_METHODS);
export const settlementStatusEnum = pgEnum("settlement_status", SETTLEMENT_STATUSES);

/** Cuota mensual de un contrato. Una por contrato y período. */
export const rentCharge = pgTable(
  "rent_charge",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => rentalContract.id),
    /** Primer día del mes. */
    period: date("period").notNull(),
    dueDate: date("due_date").notNull(),
    currency: currencyEnum("currency").notNull(),
    createdById: uuid("created_by_id").references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("rent_charge_contract_period_uq").on(t.contractId, t.period),
    index("rent_charge_org_period_idx").on(t.organizationId, t.period),
  ],
);

/** Conceptos de la cuota (alquiler, gastos comunes, recargos, bonificaciones…). */
export const rentChargeLine = pgTable(
  "rent_charge_line",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    chargeId: uuid("charge_id")
      .notNull()
      .references(() => rentCharge.id),
    kind: chargeLineKindEnum("kind").notNull(),
    description: text("description"),
    /** Siempre positivo; las bonificaciones restan por su tipo. */
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    createdById: uuid("created_by_id").references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [index("rent_charge_line_charge_idx").on(t.chargeId)],
);

/**
 * Pagos: append-only. Anular un pago es registrar un contra-asiento negativo que lo referencia.
 */
export const rentPayment = pgTable(
  "rent_payment",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    chargeId: uuid("charge_id")
      .notNull()
      .references(() => rentCharge.id),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    paidAt: date("paid_at").notNull(),
    method: paymentMethodEnum("method").notNull(),
    reference: text("reference"),
    voidsPaymentId: uuid("voids_payment_id").references((): AnyPgColumn => rentPayment.id),
    voidReason: text("void_reason"),
    receivedById: uuid("received_by_id").references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("rent_payment_charge_idx").on(t.chargeId),
    uniqueIndex("rent_payment_void_once_uq")
      .on(t.voidsPaymentId)
      .where(sql`${t.voidsPaymentId} is not null`),
  ],
);

/** Liquidación al propietario de lo cobrado en una cuota. */
export const ownerSettlement = pgTable(
  "owner_settlement",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    /** LIQ-000001 */
    code: text("code").notNull(),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => rentalContract.id),
    chargeId: uuid("charge_id")
      .notNull()
      .references(() => rentCharge.id),
    currency: currencyEnum("currency").notNull(),
    incomeMinor: bigint("income_minor", { mode: "bigint" }).notNull(),
    feeMinor: bigint("fee_minor", { mode: "bigint" }).notNull(),
    deductionsMinor: bigint("deductions_minor", { mode: "bigint" }).notNull(),
    netMinor: bigint("net_minor", { mode: "bigint" }).notNull(),
    /** Descuentos detallados y reparto por propietario (montos como texto). */
    deductions: jsonb("deductions")
      .$type<{ description: string; amountMinor: string }[]>()
      .notNull()
      .default([]),
    shares: jsonb("shares")
      .$type<{ contactId: string; name: string; shareBasisPoints: number; amountMinor: string }[]>()
      .notNull()
      .default([]),
    status: settlementStatusEnum("status").notNull().default("draft"),
    notes: text("notes"),
    paidAt: date("paid_at"),
    reference: text("reference"),
    voidReason: text("void_reason"),
    approvedById: uuid("approved_by_id").references(() => user.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("owner_settlement_org_code_uq").on(t.organizationId, t.code),
    uniqueIndex("owner_settlement_one_per_charge_uq")
      .on(t.chargeId)
      .where(sql`${t.status} <> 'voided'`),
    index("owner_settlement_org_status_idx").on(t.organizationId, t.status),
  ],
);
