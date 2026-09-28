import { sql } from "drizzle-orm";
import { index, integer, pgEnum, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { GOAL_METRICS } from "@crm/shared/performance";
import { createdAt, id, updatedAt } from "./_helpers";
import { user } from "./auth";
import { deal, dealStageEnum } from "./deals";
import { organization } from "./organization";

export const goalMetricEnum = pgEnum("goal_metric", GOAL_METRICS);

/**
 * Meta mensual por métrica. Sin `user_id` es la meta por defecto de la organización; con
 * usuario, la individual (pisa a la general).
 */
export const agentGoal = pgTable(
  "agent_goal",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    userId: uuid("user_id").references(() => user.id),
    metric: goalMetricEnum("metric").notNull(),
    monthlyTarget: integer("monthly_target").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("agent_goal_user_uq")
      .on(t.organizationId, t.userId, t.metric)
      .where(sql`${t.userId} is not null`),
    uniqueIndex("agent_goal_default_uq")
      .on(t.organizationId, t.metric)
      .where(sql`${t.userId} is null`),
  ],
);

/** Historial de etapas de cada operación (append-only). Alimenta métricas y puntos. */
export const dealStageEvent = pgTable(
  "deal_stage_event",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deal.id),
    fromStage: dealStageEnum("from_stage"),
    toStage: dealStageEnum("to_stage").notNull(),
    actorUserId: uuid("actor_user_id").references(() => user.id),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [index("deal_stage_event_org_idx").on(t.organizationId, t.toStage, t.occurredAt)],
);
