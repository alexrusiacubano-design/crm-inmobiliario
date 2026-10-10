import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  DEPOSIT_HOLDERS,
  OFFER_PARTIES,
  OFFER_STATUSES,
  RESERVATION_STATUSES,
  type ReservationNotary,
} from "@crm/shared/offers";
import { createdAt, id, updatedAt } from "./_helpers";
import { user } from "./auth";
import { deal } from "./deals";
import { currencyEnum, organization } from "./organization";

export const offerPartyEnum = pgEnum("offer_party", OFFER_PARTIES);
export const offerStatusEnum = pgEnum("offer_status", OFFER_STATUSES);
export const depositHolderEnum = pgEnum("deposit_holder", DEPOSIT_HOLDERS);
export const reservationStatusEnum = pgEnum("reservation_status", RESERVATION_STATUSES);

/**
 * Oferta o contraoferta dentro de una operación. El monto y quién la hizo no cambian (trigger):
 * una contraoferta es una fila nueva que apunta a la anterior. Solo una pendiente por operación.
 */
export const dealOffer = pgTable(
  "deal_offer",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deal.id, { onDelete: "cascade" }),
    previousOfferId: uuid("previous_offer_id"),
    party: offerPartyEnum("party").notNull(),
    currency: currencyEnum("currency").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    conditions: text("conditions"),
    validUntil: date("valid_until"),
    status: offerStatusEnum("status").notNull().default("pending"),
    responseNote: text("response_note"),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    respondedById: uuid("responded_by_id").references(() => user.id),
    createdById: uuid("created_by_id").references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("deal_offer_deal_idx").on(t.dealId, t.createdAt),
    index("deal_offer_org_status_idx").on(t.organizationId, t.status),
    uniqueIndex("deal_offer_one_pending_uq")
      .on(t.dealId)
      .where(sql`${t.status} = 'pending'`),
  ],
);

/** Reserva con seña. Una vigente por operación; al pasar a boleto/contrato queda convertida. */
export const dealReservation = pgTable(
  "deal_reservation",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deal.id, { onDelete: "cascade" }),
    currency: currencyEnum("currency").notNull(),
    depositMinor: bigint("deposit_minor", { mode: "bigint" }).notNull(),
    receivedAt: date("received_at").notNull(),
    expiresAt: date("expires_at").notNull(),
    holder: depositHolderEnum("holder").notNull().default("agency"),
    receiptNumber: text("receipt_number"),
    status: reservationStatusEnum("status").notNull().default("active"),
    notes: text("notes"),
    /** Firma pactada del boleto o contrato (cuándo se cobra). */
    signingDate: date("signing_date"),
    boletoSignedAt: date("boleto_signed_at"),
    boletoExpiresAt: date("boleto_expires_at"),
    /** Operación compartida con otra inmobiliaria o colega. */
    shared: boolean("shared").notNull().default(false),
    sharedWith: text("shared_with"),
    buyerNotary: jsonb("buyer_notary").$type<ReservationNotary | null>(),
    sellerNotary: jsonb("seller_notary").$type<ReservationNotary | null>(),
    cancelReason: text("cancel_reason"),
    refundedAt: date("refunded_at"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("deal_reservation_org_status_idx").on(t.organizationId, t.status, t.expiresAt),
    uniqueIndex("deal_reservation_one_active_uq")
      .on(t.dealId)
      .where(sql`${t.status} = 'active'`),
  ],
);
