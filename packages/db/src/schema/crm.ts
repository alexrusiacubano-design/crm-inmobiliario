import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  ACTIVITY_TYPES,
  CHANNEL_TYPES,
  CONTACT_KINDS,
  DOCUMENT_TYPES,
  LEAD_LOST_REASONS,
  LEAD_OPERATIONS,
  LEAD_SOURCES,
  LEAD_STATUSES,
  RELATION_TYPES,
} from "@crm/shared/crm";
import { createdAt, deletedAt, id, updatedAt } from "./_helpers";
import { user } from "./auth";
import { branch, currencyEnum, organization, team } from "./organization";

export const contactKindEnum = pgEnum("contact_kind", CONTACT_KINDS);
export const documentTypeEnum = pgEnum("document_type", DOCUMENT_TYPES);
export const channelTypeEnum = pgEnum("channel_type", CHANNEL_TYPES);
export const leadOperationEnum = pgEnum("lead_operation", LEAD_OPERATIONS);
export const leadSourceEnum = pgEnum("lead_source", LEAD_SOURCES);
export const leadStatusEnum = pgEnum("lead_status", LEAD_STATUSES);
export const leadLostReasonEnum = pgEnum("lead_lost_reason", LEAD_LOST_REASONS);
export const activityTypeEnum = pgEnum("activity_type", ACTIVITY_TYPES);
export const duplicateStatusEnum = pgEnum("duplicate_status", ["pending", "merged", "dismissed"]);

/**
 * Persona o empresa. Existe una sola vez: ser lead, cliente o propietario son roles de este
 * registro (leads, owner_profile y, desde la Fase 3, property_owner).
 */
export const contact = pgTable(
  "contact",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    kind: contactKindEnum("kind").notNull().default("person"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    companyName: text("company_name"),
    /** Nombre para mostrar y ordenar; lo calcula el servicio. */
    displayName: text("display_name").notNull(),
    documentType: documentTypeEnum("document_type"),
    /** Normalizado (solo dígitos para CI/RUT). */
    documentNumber: text("document_number"),
    nationality: text("nationality"),
    address: text("address"),
    departmentId: integer("department_id"),
    localityId: integer("locality_id"),
    notes: text("notes"),
    /** Agente responsable: define el alcance "propios". */
    assignedUserId: uuid("assigned_user_id").references(() => user.id),
    branchId: uuid("branch_id").references(() => branch.id),
    teamId: uuid("team_id").references(() => team.id),
    mergedIntoId: uuid("merged_into_id"),
    createdById: uuid("created_by_id").references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index("contact_org_name_idx").on(t.organizationId, t.displayName),
    index("contact_org_assigned_idx").on(t.organizationId, t.assignedUserId),
    index("contact_org_branch_idx").on(t.organizationId, t.branchId),
    uniqueIndex("contact_org_document_uq")
      .on(t.organizationId, t.documentType, t.documentNumber)
      .where(sql`${t.deletedAt} is null and ${t.documentNumber} is not null`),
  ],
);

export const contactChannel = pgTable(
  "contact_channel",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    type: channelTypeEnum("type").notNull(),
    value: text("value").notNull(),
    /** E.164 para teléfonos, minúsculas para email. Es lo que se compara. */
    normalized: text("normalized").notNull(),
    label: text("label"),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index("contact_channel_contact_idx").on(t.contactId),
    index("contact_channel_lookup_idx").on(t.organizationId, t.normalized),
  ],
);

export const tag = pgTable(
  "tag",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("tag_org_name_uq").on(t.organizationId, t.name)],
);

export const contactTag = pgTable(
  "contact_tag",
  {
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tag.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.contactId, t.tagId] }), index("contact_tag_tag_idx").on(t.tagId)],
);

/** Oportunidad comercial: una búsqueda concreta de un contacto (comprar, alquilar…). */
export const lead = pgTable(
  "lead",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    code: text("code").notNull(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contact.id),
    status: leadStatusEnum("status").notNull().default("new"),
    source: leadSourceEnum("source").notNull(),
    operation: leadOperationEnum("operation").notNull(),
    assignedUserId: uuid("assigned_user_id").references(() => user.id),
    branchId: uuid("branch_id").references(() => branch.id),
    teamId: uuid("team_id").references(() => team.id),
    notes: text("notes"),
    lostReason: leadLostReasonEnum("lost_reason"),
    firstContactedAt: timestamp("first_contacted_at", { withTimezone: true }),
    lastContactAt: timestamp("last_contact_at", { withTimezone: true }),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("lead_org_code_uq").on(t.organizationId, t.code),
    index("lead_org_status_idx").on(t.organizationId, t.status, t.createdAt.desc()),
    index("lead_org_assigned_idx").on(t.organizationId, t.assignedUserId, t.status),
    index("lead_contact_idx").on(t.contactId),
  ],
);

/** Qué busca el cliente. Una por lead; el motor de matching (Fase 4) la compara con propiedades. */
export const searchProfile = pgTable("search_profile", {
  leadId: uuid("lead_id")
    .primaryKey()
    .references(() => lead.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organization.id),
  operation: leadOperationEnum("operation").notNull(),
  propertyTypes: text("property_types")
    .array()
    .notNull()
    .default(sql`'{}'`),
  departmentIds: integer("department_ids")
    .array()
    .notNull()
    .default(sql`'{}'`),
  localityIds: integer("locality_ids")
    .array()
    .notNull()
    .default(sql`'{}'`),
  neighborhoodIds: integer("neighborhood_ids")
    .array()
    .notNull()
    .default(sql`'{}'`),
  currency: currencyEnum("currency").notNull().default("USD"),
  priceMinMinor: bigint("price_min_minor", { mode: "bigint" }),
  priceMaxMinor: bigint("price_max_minor", { mode: "bigint" }),
  bedroomsMin: integer("bedrooms_min"),
  bathroomsMin: integer("bathrooms_min"),
  garagesMin: integer("garages_min"),
  areaMin: integer("area_min"),
  commonExpensesMaxMinor: bigint("common_expenses_max_minor", { mode: "bigint" }),
  commonExpensesCurrency: currencyEnum("common_expenses_currency").notNull().default("UYU"),
  pets: boolean("pets").notNull().default(false),
  furnished: text("furnished").notNull().default("any"),
  features: text("features")
    .array()
    .notNull()
    .default(sql`'{}'`),
  targetDate: date("target_date"),
  notes: text("notes"),
  updatedAt: updatedAt(),
});

/**
 * Datos que solo tiene un propietario. El número de cuenta se guarda cifrado (AES-256-GCM)
 * y solo lo ve quien tiene `owner.financial.read`.
 */
export const ownerProfile = pgTable("owner_profile", {
  contactId: uuid("contact_id")
    .primaryKey()
    .references(() => contact.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organization.id),
  bankName: text("bank_name"),
  accountHolder: text("account_holder"),
  accountNumberEncrypted: text("account_number_encrypted"),
  accountNumberLast4: text("account_number_last4"),
  accountCurrency: currencyEnum("account_currency"),
  authorizationNotes: text("authorization_notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Timeline. Append-only (trigger): una nota corregida es una nota nueva. La única columna que
 * puede cambiar es `contact_id`, al fusionar contactos duplicados.
 */
export const activity = pgTable(
  "activity",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    contactId: uuid("contact_id").references(() => contact.id),
    leadId: uuid("lead_id").references(() => lead.id),
    type: activityTypeEnum("type").notNull(),
    direction: text("direction"),
    body: text("body"),
    payload: jsonb("payload").notNull().default({}),
    actorUserId: uuid("actor_user_id").references(() => user.id),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    index("activity_contact_idx").on(t.organizationId, t.contactId, t.occurredAt.desc()),
    index("activity_lead_idx").on(t.organizationId, t.leadId, t.occurredAt.desc()),
  ],
);

export const duplicateCandidate = pgTable(
  "duplicate_candidate",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    /** Siempre contactAId < contactBId para que el par sea único. */
    contactAId: uuid("contact_a_id")
      .notNull()
      .references(() => contact.id),
    contactBId: uuid("contact_b_id")
      .notNull()
      .references(() => contact.id),
    reasons: text("reasons").array().notNull(),
    score: integer("score").notNull(),
    status: duplicateStatusEnum("status").notNull().default("pending"),
    resolvedById: uuid("resolved_by_id").references(() => user.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("duplicate_pair_uq").on(t.organizationId, t.contactAId, t.contactBId),
    index("duplicate_org_status_idx").on(t.organizationId, t.status),
  ],
);

/**
 * Índice de búsqueda global. Se actualiza en la misma transacción que el registro, con los
 * campos de alcance (dueño, sucursal, equipo) para filtrar por permisos en la base.
 */
export const searchDocument = pgTable(
  "search_document",
  {
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    title: text("title").notNull(),
    subtitle: text("subtitle"),
    /** Texto normalizado (minúsculas, sin tildes) + dígitos de teléfonos y documentos. */
    body: text("body").notNull(),
    ownerUserId: uuid("owner_user_id"),
    branchId: uuid("branch_id"),
    teamId: uuid("team_id"),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.entityType, t.entityId] }),
    index("search_document_org_idx").on(t.organizationId, t.entityType),
    index("search_document_body_trgm").using("gin", sql`${t.body} gin_trgm_ops`),
  ],
);

export const relationTypeEnum = pgEnum("relation_type", RELATION_TYPES);

/** Fechas importantes de un contacto (cumpleaños, vencimientos, aniversarios). */
export const contactDate = pgTable(
  "contact_date",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    date: date("date").notNull(),
    yearly: boolean("yearly").notNull().default(false),
    createdById: uuid("created_by_id").references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [index("contact_date_contact_idx").on(t.organizationId, t.contactId)],
);

/** Vínculo entre dos contactos. Se guarda una vez y se muestra desde ambos lados. */
export const contactRelation = pgTable(
  "contact_relation",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    relatedContactId: uuid("related_contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    type: relationTypeEnum("type").notNull(),
    note: text("note"),
    createdById: uuid("created_by_id").references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("contact_relation_pair_uq").on(t.organizationId, t.contactId, t.relatedContactId, t.type),
    index("contact_relation_related_idx").on(t.organizationId, t.relatedContactId),
  ],
);
