import { index, integer, pgEnum, pgTable, text, timestamp, boolean, uuid } from "drizzle-orm/pg-core";
import { EVENT_STATUSES, EVENT_TYPES, VISIT_OUTCOMES } from "@crm/shared/agenda";
import { createdAt, deletedAt, id, updatedAt } from "./_helpers";
import { user } from "./auth";
import { contact, lead } from "./crm";
import { branch, organization, team } from "./organization";
import { property } from "./property";

export const eventTypeEnum = pgEnum("event_type", EVENT_TYPES);
export const eventStatusEnum = pgEnum("event_status", EVENT_STATUSES);
export const visitOutcomeEnum = pgEnum("visit_outcome", VISIT_OUTCOMES);

/**
 * Evento de agenda. El responsable define el alcance "propios" (igual que en leads y
 * propiedades); sucursal y equipo se heredan del responsable al crear o reasignar.
 */
export const calendarEvent = pgTable(
  "calendar_event",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    type: eventTypeEnum("type").notNull(),
    status: eventStatusEnum("status").notNull().default("scheduled"),
    title: text("title").notNull(),
    description: text("description"),
    location: text("location"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    allDay: boolean("all_day").notNull().default(false),
    contactId: uuid("contact_id").references(() => contact.id),
    leadId: uuid("lead_id").references(() => lead.id),
    propertyId: uuid("property_id").references(() => property.id),
    assignedUserId: uuid("assigned_user_id")
      .notNull()
      .references(() => user.id),
    branchId: uuid("branch_id").references(() => branch.id),
    teamId: uuid("team_id").references(() => team.id),
    outcome: visitOutcomeEnum("outcome"),
    rating: integer("rating"),
    feedback: text("feedback"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedById: uuid("closed_by_id").references(() => user.id),
    createdById: uuid("created_by_id").references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index("calendar_event_org_start_idx").on(t.organizationId, t.startsAt),
    index("calendar_event_org_assigned_idx").on(t.organizationId, t.assignedUserId, t.startsAt),
    index("calendar_event_contact_idx").on(t.organizationId, t.contactId),
    index("calendar_event_property_idx").on(t.organizationId, t.propertyId),
  ],
);
