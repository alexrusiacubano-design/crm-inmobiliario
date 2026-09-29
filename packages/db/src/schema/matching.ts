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
import { MATCH_STATUSES, type MatchReason } from "@crm/shared/matching";
import { createdAt, id, updatedAt } from "./_helpers";
import { user } from "./auth";
import { lead } from "./crm";
import { organization } from "./organization";
import { property } from "./property";

export const matchStatusEnum = pgEnum("match_status", MATCH_STATUSES);

/**
 * Cruce lead ↔ propiedad. El motor recalcula puntaje y motivos; el agente lleva el estado
 * (enviada, le interesa, descartada). `active` = hoy sigue cumpliendo la búsqueda: las que
 * dejaron de cumplir se conservan si ya se trabajaron, para no perder el historial.
 */
export const propertyMatch = pgTable(
  "property_match",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => lead.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => property.id, { onDelete: "cascade" }),
    status: matchStatusEnum("status").notNull().default("suggested"),
    score: integer("score").notNull(),
    reasons: jsonb("reasons").$type<MatchReason[]>().notNull().default([]),
    active: boolean("active").notNull().default(true),
    note: text("note"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
    statusChangedById: uuid("status_changed_by_id").references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("property_match_lead_property_uq").on(t.leadId, t.propertyId),
    index("property_match_org_status_idx").on(t.organizationId, t.status, t.createdAt),
    index("property_match_property_idx").on(t.propertyId),
  ],
);
