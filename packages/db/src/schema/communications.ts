import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { INQUIRY_CHANNELS, INQUIRY_STATUSES, TEMPLATE_CHANNELS } from "@crm/shared/communications";
import { createdAt, id, updatedAt } from "./_helpers";
import { user } from "./auth";
import { contact, lead } from "./crm";
import { organization } from "./organization";
import { property } from "./property";

export const inquiryChannelEnum = pgEnum("inquiry_channel", INQUIRY_CHANNELS);
export const inquiryStatusEnum = pgEnum("inquiry_status", INQUIRY_STATUSES);
export const templateChannelEnum = pgEnum("template_channel", TEMPLATE_CHANNELS);

/** Consulta entrante (web, portal, bot…) que espera que una persona la tome. */
export const inquiry = pgTable(
  "inquiry",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    channel: inquiryChannelEnum("channel").notNull(),
    name: text("name"),
    phone: text("phone"),
    email: text("email"),
    message: text("message").notNull(),
    propertyId: uuid("property_id").references(() => property.id),
    externalRef: text("external_ref"),
    status: inquiryStatusEnum("status").notNull().default("open"),
    assignedUserId: uuid("assigned_user_id").references(() => user.id),
    takenAt: timestamp("taken_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    resolutionNote: text("resolution_note"),
    contactId: uuid("contact_id").references(() => contact.id),
    leadId: uuid("lead_id").references(() => lead.id),
    createdById: uuid("created_by_id").references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("inquiry_org_status_idx").on(t.organizationId, t.status, t.createdAt),
    uniqueIndex("inquiry_org_external_uq")
      .on(t.organizationId, t.externalRef)
      .where(sql`${t.externalRef} is not null`),
  ],
);

/** Conversación interna: directa (2 personas) o grupo. */
export const chatConversation = pgTable(
  "chat_conversation",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    isGroup: boolean("is_group").notNull().default(false),
    title: text("title"),
    /** Para directas: "userA:userB" ordenado, evita duplicados. */
    directKey: text("direct_key"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("chat_conversation_direct_uq")
      .on(t.organizationId, t.directKey)
      .where(sql`${t.directKey} is not null`),
  ],
);

export const chatMember = pgTable(
  "chat_member",
  {
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => chatConversation.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.userId] }), index("chat_member_user_idx").on(t.userId)],
);

/** Mensajes: append-only (no se editan ni se borran). */
export const chatMessage = pgTable(
  "chat_message",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => chatConversation.id),
    authorUserId: uuid("author_user_id")
      .notNull()
      .references(() => user.id),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("chat_message_conversation_idx").on(t.conversationId, t.createdAt)],
);

export const messageTemplate = pgTable(
  "message_template",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    name: text("name").notNull(),
    channel: templateChannelEnum("channel").notNull(),
    subject: text("subject"),
    body: text("body").notNull(),
    active: boolean("active").notNull().default(true),
    createdById: uuid("created_by_id").references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("message_template_org_name_uq").on(t.organizationId, t.channel, t.name)],
);
