import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  INVOICE_KINDS,
  INVOICE_SOURCE_TYPES,
  INVOICE_STATUSES,
  RECEIVER_DOC_TYPES,
} from "@crm/shared/invoicing";
import { createdAt, id, updatedAt } from "./_helpers";
import { user } from "./auth";
import { contact } from "./crm";
import { currencyEnum, organization } from "./organization";

export const invoiceStatusEnum = pgEnum("invoice_status", INVOICE_STATUSES);
export const invoiceKindEnum = pgEnum("invoice_kind", INVOICE_KINDS);
export const receiverDocTypeEnum = pgEnum("receiver_doc_type", RECEIVER_DOC_TYPES);
export const invoiceSourceTypeEnum = pgEnum("invoice_source_type", INVOICE_SOURCE_TYPES);

/**
 * Factura de honorarios. Se arma como borrador y se marca emitida con la serie y el número
 * del CFE (emitido en el portal de DGI o un proveedor). Emitida ya no se modifica: se anula.
 */
export const invoice = pgTable(
  "invoice",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    /** FAC-000001 (numeración interna). */
    code: text("code").notNull(),
    kind: invoiceKindEnum("kind").notNull(),
    contactId: uuid("contact_id").references(() => contact.id),
    receiverName: text("receiver_name").notNull(),
    receiverDocType: receiverDocTypeEnum("receiver_doc_type").notNull(),
    receiverDoc: text("receiver_doc"),
    receiverAddress: text("receiver_address"),
    currency: currencyEnum("currency").notNull(),
    taxIncluded: boolean("tax_included").notNull().default(false),
    subtotalMinor: bigint("subtotal_minor", { mode: "bigint" }).notNull(),
    taxMinor: bigint("tax_minor", { mode: "bigint" }).notNull(),
    totalMinor: bigint("total_minor", { mode: "bigint" }).notNull(),
    status: invoiceStatusEnum("status").notNull().default("draft"),
    cfeSeries: text("cfe_series"),
    cfeNumber: integer("cfe_number"),
    issuedAt: date("issued_at"),
    issuedById: uuid("issued_by_id").references(() => user.id),
    voidReason: text("void_reason"),
    notes: text("notes"),
    createdById: uuid("created_by_id").references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("invoice_org_code_uq").on(t.organizationId, t.code),
    uniqueIndex("invoice_org_cfe_uq")
      .on(t.organizationId, t.kind, t.cfeSeries, t.cfeNumber)
      .where(sql`${t.cfeNumber} is not null`),
    index("invoice_org_status_idx").on(t.organizationId, t.status, t.createdAt.desc()),
  ],
);

/** Concepto de la factura; si viene de un honorario o una comisión de administración, lo referencia. */
export const invoiceLine = pgTable(
  "invoice_line",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoice.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    description: text("description").notNull(),
    netMinor: bigint("net_minor", { mode: "bigint" }).notNull(),
    taxRateBp: integer("tax_rate_bp").notNull(),
    taxMinor: bigint("tax_minor", { mode: "bigint" }).notNull(),
    sourceType: invoiceSourceTypeEnum("source_type"),
    sourceId: uuid("source_id"),
    /** Falso cuando la factura se anula: la fuente vuelve a quedar para facturar. */
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    index("invoice_line_invoice_idx").on(t.invoiceId),
    uniqueIndex("invoice_line_source_active_uq")
      .on(t.sourceType, t.sourceId)
      .where(sql`${t.sourceId} is not null and ${t.active}`),
  ],
);
