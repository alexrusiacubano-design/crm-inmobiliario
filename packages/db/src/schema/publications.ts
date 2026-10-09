import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  AD_LEVELS,
  EXCHANGE_SOURCES,
  PORTALS,
  PUBLICATION_STATUSES,
  type LevelQuotas,
} from "@crm/shared/publications";
import { createdAt, id, updatedAt } from "./_helpers";
import { user } from "./auth";
import { organization } from "./organization";
import { property } from "./property";

export const portalEnum = pgEnum("portal", PORTALS);
export const adLevelEnum = pgEnum("ad_level", AD_LEVELS);
export const publicationStatusEnum = pgEnum("publication_status", PUBLICATION_STATUSES);
export const exchangeSourceEnum = pgEnum("exchange_source", EXCHANGE_SOURCES);

/** Cuenta de la inmobiliaria en cada portal: si está activa, su plan (cupos por nivel) y el token del feed. */
export const portalAccount = pgTable(
  "portal_account",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    portal: portalEnum("portal").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    accountRef: text("account_ref"),
    quotas: jsonb("quotas").$type<LevelQuotas>().notNull().default({}),
    /** Token del feed XML (secreto: quien lo tiene lee los avisos publicados). */
    feedToken: text("feed_token").notNull(),
    /** Credenciales del portal (JSON cifrado con FIELD_ENCRYPTION_KEY). */
    credentialsEncrypted: text("credentials_encrypted"),
    /** Para mostrar sin descifrar: valores no secretos completos y secretos enmascarados. */
    credentialHints: jsonb("credential_hints").$type<Record<string, string>>().notNull().default({}),
    /** Tokens OAuth (Mercado Libre), cifrados. */
    tokensEncrypted: text("tokens_encrypted"),
    /** Cuenta conectada (id y nombre del usuario en el portal, vencimiento del token). */
    connection: jsonb("connection").$type<{
      userId?: string;
      nickname?: string;
      connectedAt?: string;
      expiresAt?: string;
    } | null>(),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("portal_account_org_portal_uq").on(t.organizationId, t.portal),
    uniqueIndex("portal_account_feed_token_uq").on(t.feedToken),
  ],
);

/** Aviso de una propiedad en un portal. */
export const propertyPublication = pgTable(
  "property_publication",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => property.id, { onDelete: "cascade" }),
    portal: portalEnum("portal").notNull(),
    level: adLevelEnum("level").notNull().default("basic"),
    status: publicationStatusEnum("status").notNull().default("published"),
    externalId: text("external_id"),
    url: text("url"),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: date("expires_at"),
    views: integer("views"),
    contacts: integer("contacts"),
    notes: text("notes"),
    /** Sincronización con la API del portal (avisos publicados automáticamente). */
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    syncError: text("sync_error"),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).notNull().defaultNow(),
    createdById: uuid("created_by_id").references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("property_publication_property_portal_uq").on(t.propertyId, t.portal),
    index("property_publication_org_status_idx").on(t.organizationId, t.portal, t.status),
  ],
);

/** Tipo de cambio de referencia por día (pesos por dólar). */
export const exchangeRate = pgTable(
  "exchange_rate",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    date: date("date").notNull(),
    uyuPerUsd: numeric("uyu_per_usd", { precision: 10, scale: 4 }).notNull(),
    source: exchangeSourceEnum("source").notNull(),
    createdById: uuid("created_by_id").references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("exchange_rate_org_date_uq").on(t.organizationId, t.date)],
);
