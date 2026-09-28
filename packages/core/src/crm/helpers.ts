import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  activity,
  contact,
  contactChannel,
  lead,
  membership,
  searchDocument,
  team,
  teamMember,
  type DbOrTx,
} from "@crm/db";
import {
  CHANNEL_TYPE_LABELS,
  LEAD_OPERATION_LABELS,
  LEAD_STATUS_LABELS,
  formatCI,
  normalizeText,
  onlyDigits,
  type ActivityType,
  type ContactKind,
  type LeadOperation,
  type LeadStatus,
} from "@crm/shared";
import type { ResourceRef } from "@crm/shared/rbac";
import { toAuditJson } from "../audit";
import type { RequestContext } from "../context";
import { ValidationError } from "../errors";

export function buildDisplayName(c: {
  kind: ContactKind;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
}): string {
  if (c.kind === "company") return (c.companyName ?? "").trim() || "Empresa sin nombre";
  return [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || "Sin nombre";
}

export function contactRef(c: {
  organizationId: string;
  assignedUserId: string | null;
  branchId: string | null;
  teamId: string | null;
}): ResourceRef {
  return {
    organizationId: c.organizationId,
    ownerUserId: c.assignedUserId,
    branchId: c.branchId,
    teamId: c.teamId,
  };
}

export const leadRef = contactRef;

/**
 * Sucursal y equipo que heredan los registros asignados a un usuario. Valida que el usuario
 * sea miembro activo de la organización.
 */
export async function resolveAssignment(
  tx: DbOrTx,
  organizationId: string,
  userId: string,
): Promise<{ branchId: string | null; teamId: string | null }> {
  const [m] = await tx
    .select({ id: membership.id, defaultBranchId: membership.defaultBranchId })
    .from(membership)
    .where(
      and(
        eq(membership.organizationId, organizationId),
        eq(membership.userId, userId),
        eq(membership.status, "active"),
      ),
    );
  if (!m)
    throw new ValidationError("El responsable no es un usuario activo", {
      assignedUserId: ["Usuario inválido"],
    });
  const [firstTeam] = await tx
    .select({ teamId: team.id, branchId: team.branchId })
    .from(teamMember)
    .innerJoin(team, and(eq(team.id, teamMember.teamId), eq(team.isActive, true), isNull(team.deletedAt)))
    .where(eq(teamMember.membershipId, m.id))
    .orderBy(asc(team.name))
    .limit(1);
  return { branchId: m.defaultBranchId ?? firstTeam?.branchId ?? null, teamId: firstTeam?.teamId ?? null };
}

export async function logActivity(
  tx: DbOrTx,
  ctx: RequestContext,
  entry: {
    type: ActivityType;
    contactId?: string | null;
    leadId?: string | null;
    body?: string | null;
    direction?: "inbound" | "outbound" | null;
    payload?: Record<string, unknown>;
    occurredAt?: Date | null;
  },
): Promise<void> {
  await tx.insert(activity).values({
    organizationId: ctx.organizationId,
    contactId: entry.contactId ?? null,
    leadId: entry.leadId ?? null,
    type: entry.type,
    body: entry.body ?? null,
    direction: entry.direction ?? null,
    payload: toAuditJson(entry.payload ?? {}),
    actorUserId: ctx.userId,
    ...(entry.occurredAt ? { occurredAt: entry.occurredAt } : {}),
  });
}

/** Variantes de un teléfono para que se encuentre como "099123456", "99123456" o "+59899123456". */
function phoneSearchTerms(e164: string): string[] {
  const digits = onlyDigits(e164);
  const terms = [digits];
  if (digits.startsWith("598")) {
    const local = digits.slice(3);
    terms.push(local, local.startsWith("9") ? `0${local}` : local);
  }
  return terms;
}

export async function syncContactSearch(tx: DbOrTx, contactId: string): Promise<void> {
  const [c] = await tx.select().from(contact).where(eq(contact.id, contactId));
  if (!c) return;
  if (c.deletedAt) {
    await tx
      .delete(searchDocument)
      .where(and(eq(searchDocument.entityType, "contact"), eq(searchDocument.entityId, contactId)));
    return;
  }
  const channels = await tx.select().from(contactChannel).where(eq(contactChannel.contactId, contactId));
  const primary = channels.find((ch) => ch.isPrimary) ?? channels[0];
  const doc = c.documentNumber
    ? c.documentType === "ci"
      ? formatCI(c.documentNumber)
      : c.documentNumber
    : null;
  const subtitle = [primary ? `${CHANNEL_TYPE_LABELS[primary.type]} ${primary.value}` : null, doc]
    .filter(Boolean)
    .join(" · ");
  const body = [
    normalizeText(c.displayName),
    c.companyName ? normalizeText(c.companyName) : "",
    ...channels.filter((ch) => ch.type === "email").map((ch) => ch.normalized),
    ...channels.filter((ch) => ch.type !== "email").flatMap((ch) => phoneSearchTerms(ch.normalized)),
    c.documentNumber ? normalizeText(c.documentNumber) : "",
    c.address ? normalizeText(c.address) : "",
  ]
    .filter(Boolean)
    .join(" ");

  const values = {
    entityType: "contact",
    entityId: c.id,
    organizationId: c.organizationId,
    title: c.displayName,
    subtitle: subtitle || null,
    body,
    ownerUserId: c.assignedUserId,
    branchId: c.branchId,
    teamId: c.teamId,
  };
  await tx
    .insert(searchDocument)
    .values(values)
    .onConflictDoUpdate({
      target: [searchDocument.entityType, searchDocument.entityId],
      set: { ...values, updatedAt: new Date() },
    });
}

export async function syncLeadSearch(tx: DbOrTx, leadIds: readonly string[]): Promise<void> {
  if (leadIds.length === 0) return;
  const rows = await tx
    .select({ lead, contactName: contact.displayName })
    .from(lead)
    .innerJoin(contact, eq(contact.id, lead.contactId))
    .where(inArray(lead.id, [...leadIds]));
  for (const { lead: l, contactName } of rows) {
    if (l.deletedAt) {
      await tx
        .delete(searchDocument)
        .where(and(eq(searchDocument.entityType, "lead"), eq(searchDocument.entityId, l.id)));
      continue;
    }
    const values = {
      entityType: "lead",
      entityId: l.id,
      organizationId: l.organizationId,
      title: `${l.code} · ${contactName}`,
      subtitle: `${LEAD_OPERATION_LABELS[l.operation as LeadOperation]} · ${LEAD_STATUS_LABELS[l.status as LeadStatus]}`,
      body: `${l.code.toLowerCase()} ${normalizeText(contactName)}`,
      ownerUserId: l.assignedUserId,
      branchId: l.branchId,
      teamId: l.teamId,
    };
    await tx
      .insert(searchDocument)
      .values(values)
      .onConflictDoUpdate({
        target: [searchDocument.entityType, searchDocument.entityId],
        set: { ...values, updatedAt: new Date() },
      });
  }
}
