import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
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
import { createdAt, deletedAt, id, updatedAt } from "./_helpers";
import { user } from "./auth";

export const currencyEnum = pgEnum("currency", ["UYU", "USD"]);
export const scopeEnum = pgEnum("permission_scope", ["own", "team", "branch", "org"]);
export const membershipStatusEnum = pgEnum("membership_status", ["active", "suspended"]);

/** Tenant. Toda tabla de negocio lleva `organization_id`. */
export const organization = pgTable("organization", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  countryCode: char("country_code", { length: 2 }).notNull().default("UY"),
  defaultCurrency: currencyEnum("default_currency").notNull().default("USD"),
  timezone: text("timezone").notNull().default("America/Montevideo"),
  locale: text("locale").notNull().default("es-UY"),
  /** Datos de demostración: se muestran con un distintivo DEMO en la interfaz. */
  isDemo: boolean("is_demo").notNull().default(false),
  /** Datos para documentos impresos (recibos, liquidaciones, fichas). */
  legalName: text("legal_name"),
  taxId: text("tax_id"),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  website: text("website"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const branch = pgTable(
  "branch",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    name: text("name").notNull(),
    code: text("code").notNull(),
    address: text("address"),
    phone: text("phone"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("branch_org_code_uq").on(t.organizationId, t.code),
    index("branch_org_idx").on(t.organizationId, t.isActive),
  ],
);

export const membership = pgTable(
  "membership",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    status: membershipStatusEnum("status").notNull().default("active"),
    defaultBranchId: uuid("default_branch_id").references(() => branch.id),
    jobTitle: text("job_title"),
    phone: text("phone"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("membership_org_user_uq").on(t.organizationId, t.userId),
    index("membership_user_idx").on(t.userId),
  ],
);

export const team = pgTable(
  "team",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    name: text("name").notNull(),
    leadMembershipId: uuid("lead_membership_id").references(() => membership.id),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("team_org_branch_name_uq").on(t.organizationId, t.branchId, t.name),
    index("team_org_idx").on(t.organizationId, t.isActive),
  ],
);

export const teamMember = pgTable(
  "team_member",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    teamId: uuid("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => membership.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.membershipId] }),
    index("team_member_membership_idx").on(t.membershipId),
  ],
);

/** Catálogo de permisos; lo sincroniza el seed desde `@crm/shared`. */
export const permission = pgTable("permission", {
  code: text("code").primaryKey(),
  module: text("module").notNull(),
  label: text("label").notNull(),
  scopable: boolean("scopable").notNull(),
  sensitive: boolean("sensitive").notNull().default(false),
});

export const role = pgTable(
  "role",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    isSystem: boolean("is_system").notNull().default(false),
    isLocked: boolean("is_locked").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [uniqueIndex("role_org_key_uq").on(t.organizationId, t.key)],
);

export const rolePermission = pgTable(
  "role_permission",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => role.id, { onDelete: "cascade" }),
    permissionCode: text("permission_code")
      .notNull()
      .references(() => permission.code),
    scope: scopeEnum("scope").notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionCode] })],
);

export const membershipRole = pgTable(
  "membership_role",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => membership.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => role.id),
    /** Si se indica, el rol aplica solo dentro de esta sucursal. */
    branchId: uuid("branch_id").references(() => branch.id),
    createdAt: createdAt(),
  },
  (t) => [
    // Unicidad (membership, role, branch) con NULLS NOT DISTINCT: se crea en la migración
    // 0001_append_only_guards.sql porque drizzle-kit aún no lo soporta.
    index("membership_role_membership_idx").on(t.membershipId),
    index("membership_role_role_idx").on(t.roleId),
  ],
);

/**
 * Auditoría. Append-only: un trigger de la base rechaza UPDATE y DELETE.
 * Se escribe en la MISMA transacción que el cambio auditado.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    actorUserId: uuid("actor_user_id").references(() => user.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    metadata: jsonb("metadata").$type<{
      ip?: string | null;
      userAgent?: string | null;
      requestId?: string;
    }>(),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_org_created_idx").on(t.organizationId, t.createdAt.desc()),
    index("audit_org_entity_idx").on(t.organizationId, t.entityType, t.entityId),
    index("audit_org_actor_idx").on(t.organizationId, t.actorUserId),
  ],
);

/**
 * Outbox de eventos de dominio. Solo se permite actualizar las columnas de entrega
 * (processed_at, attempts, last_error); el resto es inmutable (trigger).
 */
export const domainEvent = pgTable(
  "domain_event",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    type: text("type").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    payload: jsonb("payload").notNull().default({}),
    actorUserId: uuid("actor_user_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
  },
  (t) => [
    index("domain_event_pending_idx")
      .on(t.occurredAt)
      .where(sql`${t.processedAt} is null`),
    index("domain_event_org_type_idx").on(t.organizationId, t.type),
  ],
);

/** Numeración legible por organización: PROP-000001, OP-000001… */
export const sequence = pgTable(
  "sequence",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    prefix: text("prefix").notNull(),
    lastValue: bigint("last_value", { mode: "bigint" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.prefix] })],
);
