import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { PROPERTY_TYPES } from "@crm/shared/crm";
import {
  ACQUISITION_STAGES,
  DOCUMENT_CATEGORIES,
  DOCUMENT_STATUSES,
  DOCUMENT_VISIBILITIES,
  EXPENSE_KINDS,
  EXPENSE_PERIODS,
  MEDIA_KINDS,
  ORIENTATIONS,
  PRICE_FIELDS,
  PROPERTY_CONDITIONS,
  PROPERTY_OPERATIONS,
  PROPERTY_STATUSES,
  VALUATION_METHODS,
} from "@crm/shared/property";
import { createdAt, deletedAt, id, updatedAt } from "./_helpers";
import { user } from "./auth";
import { contact } from "./crm";
import { department, locality, neighborhood } from "./geo";
import { branch, currencyEnum, organization, team } from "./organization";

export const propertyTypeEnum = pgEnum("property_type", PROPERTY_TYPES);
export const propertyOperationEnum = pgEnum("property_operation", PROPERTY_OPERATIONS);
export const propertyStatusEnum = pgEnum("property_status", PROPERTY_STATUSES);
export const orientationEnum = pgEnum("orientation", ORIENTATIONS);
export const propertyConditionEnum = pgEnum("property_condition", PROPERTY_CONDITIONS);
export const expenseKindEnum = pgEnum("expense_kind", EXPENSE_KINDS);
export const expensePeriodEnum = pgEnum("expense_period", EXPENSE_PERIODS);
export const mediaKindEnum = pgEnum("media_kind", MEDIA_KINDS);
export const priceFieldEnum = pgEnum("price_field", PRICE_FIELDS);
export const acquisitionStageEnum = pgEnum("acquisition_stage", ACQUISITION_STAGES);
export const valuationMethodEnum = pgEnum("valuation_method", VALUATION_METHODS);
export const documentCategoryEnum = pgEnum("document_category", DOCUMENT_CATEGORIES);
export const documentVisibilityEnum = pgEnum("document_visibility", DOCUMENT_VISIBILITIES);
export const documentStatusEnum = pgEnum("document_status", DOCUMENT_STATUSES);

export const property = pgTable(
  "property",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    /** PROP-000001, único por organización. */
    code: text("code").notNull(),
    type: propertyTypeEnum("type").notNull(),
    operations: propertyOperationEnum("operations").array().notNull(),
    status: propertyStatusEnum("status").notNull().default("draft"),
    title: text("title"),
    description: text("description"),
    departmentId: integer("department_id").references(() => department.id),
    localityId: integer("locality_id").references(() => locality.id),
    neighborhoodId: integer("neighborhood_id").references(() => neighborhood.id),
    address: text("address"),
    unit: text("unit"),
    padron: text("padron"),
    latitude: numeric("latitude", { precision: 9, scale: 6 }),
    longitude: numeric("longitude", { precision: 9, scale: 6 }),
    bedrooms: integer("bedrooms"),
    bathrooms: integer("bathrooms"),
    suites: integer("suites"),
    garages: integer("garages"),
    totalArea: numeric("total_area", { precision: 12, scale: 2 }),
    builtArea: numeric("built_area", { precision: 10, scale: 2 }),
    floor: text("floor"),
    yearBuilt: integer("year_built"),
    orientation: orientationEnum("orientation"),
    condition: propertyConditionEnum("condition"),
    features: text("features")
      .array()
      .notNull()
      .default(sql`'{}'`),
    petsAllowed: boolean("pets_allowed").notNull().default(false),
    furnished: boolean("furnished").notNull().default(false),
    /** La inmobiliaria tiene la exclusividad de la propiedad (y hasta cuándo, si se pactó). */
    exclusive: boolean("exclusive").notNull().default(false),
    exclusiveUntil: date("exclusive_until"),
    /** Comisión acordada en basis points (300 = 3 %). */
    commissionBasisPoints: integer("commission_basis_points"),
    internalNotes: text("internal_notes"),
    /** Agente responsable (alcance "propios"). */
    assignedUserId: uuid("assigned_user_id").references(() => user.id),
    captadorUserId: uuid("captador_user_id").references(() => user.id),
    branchId: uuid("branch_id").references(() => branch.id),
    teamId: uuid("team_id").references(() => team.id),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("property_org_code_uq").on(t.organizationId, t.code),
    index("property_org_status_idx").on(t.organizationId, t.status, t.updatedAt.desc()),
    index("property_org_assigned_idx").on(t.organizationId, t.assignedUserId),
    index("property_org_location_idx").on(t.organizationId, t.localityId, t.neighborhoodId),
    index("property_operations_gin").using("gin", t.operations),
  ],
);

/** Precios vigentes por operación. Los cambios quedan en property_price_history. */
export const propertyPrice = pgTable(
  "property_price",
  {
    propertyId: uuid("property_id")
      .notNull()
      .references(() => property.id, { onDelete: "cascade" }),
    operation: propertyOperationEnum("operation").notNull(),
    currency: currencyEnum("currency").notNull(),
    listMinor: bigint("list_minor", { mode: "bigint" }),
    ownerAskingMinor: bigint("owner_asking_minor", { mode: "bigint" }),
    /** Sensible: solo con `property.price.floor.read`. */
    minimumMinor: bigint("minimum_minor", { mode: "bigint" }),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.propertyId, t.operation] }),
    index("property_price_list_idx").on(t.operation, t.currency, t.listMinor),
  ],
);

/** Historial de precios: append-only (trigger). */
export const propertyPriceHistory = pgTable(
  "property_price_history",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => property.id),
    operation: propertyOperationEnum("operation").notNull(),
    field: priceFieldEnum("field").notNull(),
    currency: currencyEnum("currency").notNull(),
    oldMinor: bigint("old_minor", { mode: "bigint" }),
    newMinor: bigint("new_minor", { mode: "bigint" }),
    reason: text("reason"),
    changedById: uuid("changed_by_id").references(() => user.id),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("price_history_property_idx").on(t.propertyId, t.changedAt.desc())],
);

export const propertyExpense = pgTable(
  "property_expense",
  {
    id: id(),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => property.id, { onDelete: "cascade" }),
    kind: expenseKindEnum("kind").notNull(),
    label: text("label"),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: currencyEnum("currency").notNull(),
    period: expensePeriodEnum("period").notNull(),
  },
  (t) => [index("property_expense_property_idx").on(t.propertyId)],
);

/** Copropiedad: participación en basis points (10000 = 100 %). La suma se valida en el servicio. */
export const propertyOwner = pgTable(
  "property_owner",
  {
    propertyId: uuid("property_id")
      .notNull()
      .references(() => property.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contact.id),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    shareBasisPoints: integer("share_basis_points").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.propertyId, t.contactId] }),
    index("property_owner_contact_idx").on(t.contactId),
  ],
);

export const propertyMedia = pgTable(
  "property_media",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => property.id, { onDelete: "cascade" }),
    kind: mediaKindEnum("kind").notNull(),
    /** Clave en el almacenamiento (fotos y planos). */
    storageKey: text("storage_key"),
    thumbKey: text("thumb_key"),
    /** Enlace externo (videos de YouTube/Vimeo). */
    url: text("url"),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),
    width: integer("width"),
    height: integer("height"),
    caption: text("caption"),
    position: integer("position").notNull(),
    isCover: boolean("is_cover").notNull().default(false),
    createdById: uuid("created_by_id").references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("property_media_order_idx").on(t.propertyId, t.position),
    uniqueIndex("property_media_cover_uq")
      .on(t.propertyId)
      .where(sql`${t.isCover}`),
  ],
);

/** Expediente digital. Un documento se vincula a una o varias entidades (document_link). */
export const document = pgTable(
  "document",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    category: documentCategoryEnum("category").notNull(),
    type: text("type").notNull(),
    name: text("name").notNull(),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    expiresAt: date("expires_at"),
    visibility: documentVisibilityEnum("visibility").notNull().default("internal"),
    status: documentStatusEnum("status").notNull().default("valid"),
    /** Responsable: define el alcance "propios" en documentos restringidos. */
    responsibleUserId: uuid("responsible_user_id").references(() => user.id),
    branchId: uuid("branch_id").references(() => branch.id),
    teamId: uuid("team_id").references(() => team.id),
    createdById: uuid("created_by_id").references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index("document_org_category_idx").on(t.organizationId, t.category, t.createdAt.desc()),
    index("document_org_expires_idx")
      .on(t.organizationId, t.expiresAt)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export const documentLink = pgTable(
  "document_link",
  {
    documentId: uuid("document_id")
      .notNull()
      .references(() => document.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
  },
  (t) => [
    primaryKey({ columns: [t.documentId, t.entityType, t.entityId] }),
    index("document_link_entity_idx").on(t.organizationId, t.entityType, t.entityId),
  ],
);

/** Captación: pipeline Prospecto → … → Captado → Publicado. */
export const acquisition = pgTable(
  "acquisition",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    code: text("code").notNull(),
    stage: acquisitionStageEnum("stage").notNull().default("prospect"),
    ownerContactId: uuid("owner_contact_id")
      .notNull()
      .references(() => contact.id),
    propertyId: uuid("property_id").references(() => property.id),
    propertyType: propertyTypeEnum("property_type").notNull(),
    operation: propertyOperationEnum("operation").notNull(),
    address: text("address"),
    padron: text("padron"),
    localityId: integer("locality_id").references(() => locality.id),
    neighborhoodId: integer("neighborhood_id").references(() => neighborhood.id),
    latitude: numeric("latitude", { precision: 9, scale: 6 }),
    longitude: numeric("longitude", { precision: 9, scale: 6 }),
    sourcePortal: text("source_portal"),
    portalUrl: text("portal_url"),
    captadorUserId: uuid("captador_user_id").references(() => user.id),
    branchId: uuid("branch_id").references(() => branch.id),
    teamId: uuid("team_id").references(() => team.id),
    exclusive: boolean("exclusive").notNull().default(false),
    exclusiveFrom: date("exclusive_from"),
    exclusiveUntil: date("exclusive_until"),
    commissionBasisPoints: integer("commission_basis_points"),
    currency: currencyEnum("currency").notNull().default("USD"),
    askingMinor: bigint("asking_minor", { mode: "bigint" }),
    recommendedMinor: bigint("recommended_minor", { mode: "bigint" }),
    publicationAuthorized: boolean("publication_authorized").notNull().default(false),
    lostReason: text("lost_reason"),
    notes: text("notes"),
    stageChangedAt: timestamp("stage_changed_at", { withTimezone: true }).notNull().defaultNow(),
    capturedAt: timestamp("captured_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("acquisition_org_code_uq").on(t.organizationId, t.code),
    index("acquisition_org_stage_idx").on(t.organizationId, t.stage),
    index("acquisition_org_captador_idx").on(t.organizationId, t.captadorUserId),
    index("acquisition_property_idx").on(t.propertyId),
    index("acquisition_exclusive_idx")
      .on(t.organizationId, t.exclusiveUntil)
      .where(sql`${t.exclusive}`),
  ],
);

/** Tasación. Inmutable: una revisión es una tasación nueva (trigger append-only). */
/** Comparable de una tasación. El precio va en unidad menor, como texto (JSON no tiene bigint). */
export interface ValuationComparable {
  address: string;
  priceMinor: string | null;
  areaM2: string | null;
  url: string | null;
}

export const valuation = pgTable(
  "valuation",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    propertyId: uuid("property_id").references(() => property.id),
    acquisitionId: uuid("acquisition_id").references(() => acquisition.id),
    method: valuationMethodEnum("method").notNull(),
    currency: currencyEnum("currency").notNull(),
    valueMinor: bigint("value_minor", { mode: "bigint" }).notNull(),
    minMinor: bigint("min_minor", { mode: "bigint" }),
    maxMinor: bigint("max_minor", { mode: "bigint" }),
    valuedAt: date("valued_at").notNull(),
    comparables: jsonb("comparables").$type<ValuationComparable[]>().notNull().default([]),
    notes: text("notes"),
    valuedById: uuid("valued_by_id").references(() => user.id),
    branchId: uuid("branch_id").references(() => branch.id),
    teamId: uuid("team_id").references(() => team.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("valuation_property_idx").on(t.propertyId, t.valuedAt.desc()),
    index("valuation_acquisition_idx").on(t.acquisitionId),
    index("valuation_org_idx").on(t.organizationId, t.valuedAt.desc()),
  ],
);
