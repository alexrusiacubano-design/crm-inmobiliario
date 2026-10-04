import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { RUN_STATUSES, type Condition } from "@crm/shared/automations";
import type { BotFaq } from "@crm/shared/bot";
import type { AutomationAction } from "@crm/shared/validation/automations";
import { createdAt, deletedAt, id, updatedAt } from "./_helpers";
import { user } from "./auth";
import { organization } from "./organization";

export const automationRunStatusEnum = pgEnum("automation_run_status", RUN_STATUSES);

/**
 * Regla disparador → condiciones → acciones. Las acciones se ejecutan con los permisos de
 * quien creó la regla (`created_by_id`); si esa persona pierde acceso, la regla falla.
 */
export const automationRule = pgTable(
  "automation_rule",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    trigger: text("trigger").notNull(),
    days: integer("days"),
    conditions: jsonb("conditions").$type<Condition[]>().notNull().default([]),
    actions: jsonb("actions").$type<AutomationAction[]>().notNull().default([]),
    /** Estado interno (último usuario de la rueda de asignación). */
    state: jsonb("state").$type<{ lastAssignedUserId?: string | null }>().notNull().default({}),
    /** Clave para firmar los webhooks (HMAC-SHA256). */
    secret: text("secret").notNull(),
    runCount: integer("run_count").notNull().default(0),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdById: uuid("created_by_id")
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("automation_rule_org_trigger_idx").on(t.organizationId, t.trigger, t.enabled)],
);

/** Historial: una fila por ejecución. `dedupe_key` evita ejecutar dos veces lo mismo. */
export const automationRun = pgTable(
  "automation_run",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => automationRule.id),
    trigger: text("trigger").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    entityLabel: text("entity_label"),
    status: automationRunStatusEnum("status").notNull().default("success"),
    results: jsonb("results")
      .$type<{ action: string; ok: boolean; detail: string }[]>()
      .notNull()
      .default([]),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("automation_run_rule_dedupe_uq").on(t.ruleId, t.dedupeKey),
    index("automation_run_org_created_idx").on(t.organizationId, t.createdAt.desc()),
  ],
);

/** Última corrida de los disparadores programados por organización. */
export const automationSchedule = pgTable("automation_schedule", {
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organization.id),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }).notNull(),
});

/** Notificación dentro del CRM (campanita). */
export const notification = pgTable(
  "notification",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    title: text("title").notNull(),
    body: text("body"),
    href: text("href"),
    ruleId: uuid("rule_id").references(() => automationRule.id),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("notification_user_idx").on(t.userId, t.organizationId, t.createdAt.desc())],
);

/** Asistente virtual del sitio web. */
export const botSettings = pgTable(
  "bot_settings",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organization.id),
    enabled: boolean("enabled").notNull().default(false),
    token: text("token").notNull(),
    greeting: text("greeting").notNull(),
    handoffMessage: text("handoff_message").notNull(),
    faqs: jsonb("faqs").$type<BotFaq[]>().notNull().default([]),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("bot_settings_token_uq").on(t.token)],
);
