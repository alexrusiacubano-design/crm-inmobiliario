import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt } from "./_helpers";
import { user } from "./auth";
import { contact } from "./crm";
import { organization } from "./organization";

export const PORTAL_ACCESS_STATUSES = ["invited", "active", "revoked"] as const;
export const portalAccessStatusEnum = pgEnum("portal_access_status", PORTAL_ACCESS_STATUSES);

/**
 * Acceso de un propietario al portal (solo lectura de sus propiedades). El usuario de Better
 * Auth se crea al activar la invitación; no tiene membresía en la organización, así que nunca
 * entra al CRM.
 */
export const ownerPortalAccess = pgTable(
  "owner_portal_access",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contact.id),
    email: text("email").notNull(),
    userId: uuid("user_id").references(() => user.id),
    status: portalAccessStatusEnum("status").notNull().default("invited"),
    /** SHA-256 del token de invitación (el token en claro solo lo ve quien invita). */
    inviteTokenHash: text("invite_token_hash"),
    inviteExpiresAt: timestamp("invite_expires_at", { withTimezone: true }),
    invitedById: uuid("invited_by_id").references(() => user.id),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("owner_portal_access_org_contact_uq").on(t.organizationId, t.contactId),
    uniqueIndex("owner_portal_access_user_uq").on(t.userId),
    uniqueIndex("owner_portal_access_token_uq").on(t.inviteTokenHash),
    index("owner_portal_access_org_idx").on(t.organizationId, t.status),
  ],
);
