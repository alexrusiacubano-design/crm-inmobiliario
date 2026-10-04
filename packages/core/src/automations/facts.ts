import { and, eq, isNull, sql } from "drizzle-orm";
import {
  contact,
  deal,
  inquiry,
  lead,
  property,
  propertyPublication,
  rentalContract,
  rentCharge,
  user,
  type DbOrTx,
} from "@crm/db";
import type { AutomationEntity, AutomationVariable, Facts } from "@crm/shared/automations";
import { formatMoney } from "@crm/shared/money";
import { DEAL_STAGE_LABELS, type DealStage } from "@crm/shared/deals";
import { LEAD_STATUS_LABELS, type LeadStatus } from "@crm/shared/crm";
import { PROPERTY_STATUS_LABELS, type PropertyStatus } from "@crm/shared/property";
import { diffDays } from "@crm/shared/rentals";
import { PORTAL_LABELS, type Portal } from "@crm/shared/publications";

/** Lo que una regla necesita saber de la entidad que la disparó. */
export interface Subject {
  entity: AutomationEntity;
  id: string;
  label: string;
  href: string;
  facts: Facts;
  vars: Partial<Record<AutomationVariable, string>>;
  assigneeUserId: string | null;
  contactId: string | null;
  leadId: string | null;
  propertyId: string | null;
  dealId: string | null;
}

const money = (minor: bigint | string, currency: "UYU" | "USD") =>
  formatMoney({ amountMinor: BigInt(minor), currency }, { showDecimals: "never" });
const major = (minor: bigint | string) => Number(BigInt(minor) / 100n);
const ymd = (d: Date, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
const propLabel = (code: string, title: string | null) => (title ? `${code} · ${title}` : code);

export async function loadSubject(
  db: DbOrTx,
  organizationId: string,
  entity: AutomationEntity,
  id: string,
  ctx: { today: string; tz: string; payload?: Record<string, unknown> | null },
): Promise<Subject | null> {
  const base = { contactId: null, leadId: null, propertyId: null, dealId: null };
  if (entity === "lead") {
    const [r] = await db
      .select({ l: lead, contactName: contact.displayName, assignee: user.name })
      .from(lead)
      .innerJoin(contact, eq(contact.id, lead.contactId))
      .leftJoin(user, eq(user.id, lead.assignedUserId))
      .where(and(eq(lead.id, id), eq(lead.organizationId, organizationId), isNull(lead.deletedAt)));
    if (!r) return null;
    const last = r.l.lastContactAt ?? r.l.createdAt;
    const days = Math.max(0, diffDays(ymd(last, ctx.tz), ctx.today));
    return {
      ...base,
      entity,
      id,
      label: `${r.l.code} · ${r.contactName}`,
      href: `/crm/leads/${id}`,
      facts: {
        operation: r.l.operation,
        source: r.l.source,
        status: r.l.status,
        hasAssignee: r.l.assignedUserId !== null,
        daysWithoutContact: days,
      },
      vars: {
        codigo: r.l.code,
        nombre: r.contactName,
        responsable: r.assignee ?? "",
        dias: String(days),
        estado: LEAD_STATUS_LABELS[r.l.status as LeadStatus],
      },
      assigneeUserId: r.l.assignedUserId,
      contactId: r.l.contactId,
      leadId: id,
    };
  }
  if (entity === "inquiry") {
    const [r] = await db
      .select({ q: inquiry, propCode: property.code, propTitle: property.title, assignee: user.name })
      .from(inquiry)
      .leftJoin(property, eq(property.id, inquiry.propertyId))
      .leftJoin(user, eq(user.id, inquiry.assignedUserId))
      .where(and(eq(inquiry.id, id), eq(inquiry.organizationId, organizationId)));
    if (!r) return null;
    const name = r.q.name ?? r.q.phone ?? r.q.email ?? "Sin nombre";
    return {
      ...base,
      entity,
      id,
      label: `Consulta de ${name}`,
      href: "/communications/inbox",
      facts: {
        channel: r.q.channel,
        hasProperty: r.q.propertyId !== null,
        hasContact: r.q.contactId !== null,
      },
      vars: {
        nombre: name,
        propiedad: r.propCode ? propLabel(r.propCode, r.propTitle) : "",
        responsable: r.assignee ?? "",
      },
      assigneeUserId: r.q.assignedUserId,
      contactId: r.q.contactId,
      propertyId: r.q.propertyId,
    };
  }
  if (entity === "deal") {
    const [r] = await db
      .select({
        d: deal,
        clientName: contact.displayName,
        propCode: property.code,
        propTitle: property.title,
        assignee: user.name,
        expiresAt: sql<
          string | null
        >`(select r.expires_at::text from deal_reservation r where r.deal_id = ${deal.id} and r.status = 'active' limit 1)`,
      })
      .from(deal)
      .innerJoin(contact, eq(contact.id, deal.clientContactId))
      .innerJoin(property, eq(property.id, deal.propertyId))
      .leftJoin(user, eq(user.id, deal.assignedUserId))
      .where(and(eq(deal.id, id), eq(deal.organizationId, organizationId), isNull(deal.deletedAt)));
    if (!r) return null;
    const days = r.expiresAt ? diffDays(ctx.today, r.expiresAt) : null;
    return {
      entity,
      id,
      label: `${r.d.code} · ${r.clientName}`,
      href: `/commercial/deals/${id}`,
      facts: {
        operation: r.d.operation,
        stage: r.d.stage,
        currency: r.d.currency,
        price: major(r.d.priceMinor),
      },
      vars: {
        codigo: r.d.code,
        nombre: r.clientName,
        propiedad: propLabel(r.propCode, r.propTitle),
        responsable: r.assignee ?? "",
        monto: money(r.d.priceMinor, r.d.currency),
        estado: DEAL_STAGE_LABELS[r.d.stage as DealStage],
        dias: days === null ? "" : String(days),
      },
      assigneeUserId: r.d.assignedUserId,
      contactId: r.d.clientContactId,
      leadId: r.d.leadId,
      propertyId: r.d.propertyId,
      dealId: id,
    };
  }
  if (entity === "contract") {
    const [r] = await db
      .select({
        c: rentalContract,
        tenant: contact.displayName,
        propCode: property.code,
        propTitle: property.title,
        assignee: user.name,
      })
      .from(rentalContract)
      .innerJoin(contact, eq(contact.id, rentalContract.tenantContactId))
      .innerJoin(property, eq(property.id, rentalContract.propertyId))
      .leftJoin(user, eq(user.id, rentalContract.assignedUserId))
      .where(
        and(
          eq(rentalContract.id, id),
          eq(rentalContract.organizationId, organizationId),
          isNull(rentalContract.deletedAt),
        ),
      );
    if (!r) return null;
    const days = diffDays(ctx.today, r.c.endDate);
    return {
      ...base,
      entity,
      id,
      label: `${r.c.code} · ${r.tenant}`,
      href: `/rentals/contracts/${id}`,
      facts: { currency: r.c.currency, rent: major(r.c.rentMinor), daysToEnd: days },
      vars: {
        codigo: r.c.code,
        nombre: r.tenant,
        propiedad: propLabel(r.propCode, r.propTitle),
        responsable: r.assignee ?? "",
        monto: money(r.c.rentMinor, r.c.currency),
        dias: String(days),
      },
      assigneeUserId: r.c.assignedUserId,
      contactId: r.c.tenantContactId,
      propertyId: r.c.propertyId,
      dealId: r.c.dealId,
    };
  }
  if (entity === "property") {
    const [r] = await db
      .select({ p: property, assignee: user.name })
      .from(property)
      .leftJoin(user, eq(user.id, property.assignedUserId))
      .where(
        and(eq(property.id, id), eq(property.organizationId, organizationId), isNull(property.deletedAt)),
      );
    if (!r) return null;
    const from = typeof ctx.payload?.from === "string" ? ctx.payload.from : null;
    return {
      ...base,
      entity,
      id,
      label: propLabel(r.p.code, r.p.title),
      href: `/properties/${id}`,
      facts: { type: r.p.type, status: r.p.status, fromStatus: from },
      vars: {
        codigo: r.p.code,
        propiedad: propLabel(r.p.code, r.p.title),
        responsable: r.assignee ?? "",
        estado: PROPERTY_STATUS_LABELS[r.p.status as PropertyStatus],
      },
      assigneeUserId: r.p.assignedUserId,
      propertyId: id,
    };
  }
  if (entity === "charge") {
    const [r] = await db
      .select({
        ch: rentCharge,
        code: rentalContract.code,
        tenantId: rentalContract.tenantContactId,
        tenant: contact.displayName,
        assignedUserId: rentalContract.assignedUserId,
        assignee: user.name,
        propertyId: rentalContract.propertyId,
        propCode: property.code,
        propTitle: property.title,
        total: sql<string>`coalesce((select sum(case when l.kind = 'discount' then -l.amount_minor else l.amount_minor end) from rent_charge_line l where l.charge_id = "rent_charge"."id"), 0)`,
        paid: sql<string>`coalesce((select sum(p.amount_minor) from rent_payment p where p.charge_id = "rent_charge"."id"), 0)`,
      })
      .from(rentCharge)
      .innerJoin(rentalContract, eq(rentalContract.id, rentCharge.contractId))
      .innerJoin(contact, eq(contact.id, rentalContract.tenantContactId))
      .innerJoin(property, eq(property.id, rentalContract.propertyId))
      .leftJoin(user, eq(user.id, rentalContract.assignedUserId))
      .where(and(eq(rentCharge.id, id), eq(rentCharge.organizationId, organizationId)));
    if (!r) return null;
    const balance = BigInt(r.total) - BigInt(r.paid);
    const days = Math.max(0, diffDays(r.ch.dueDate, ctx.today));
    return {
      ...base,
      entity,
      id,
      label: `${r.code} · ${r.tenant} · ${r.ch.period.slice(0, 7)}`,
      href: `/rentals/charges/${id}`,
      facts: { currency: r.ch.currency, balance: major(balance), daysOverdue: days },
      vars: {
        codigo: r.code,
        nombre: r.tenant,
        propiedad: propLabel(r.propCode, r.propTitle),
        responsable: r.assignee ?? "",
        monto: money(balance, r.ch.currency),
        dias: String(days),
      },
      assigneeUserId: r.assignedUserId,
      contactId: r.tenantId,
      propertyId: r.propertyId,
    };
  }
  // publication
  const [r] = await db
    .select({
      pub: propertyPublication,
      propCode: property.code,
      propTitle: property.title,
      assignedUserId: property.assignedUserId,
      assignee: user.name,
    })
    .from(propertyPublication)
    .innerJoin(property, eq(property.id, propertyPublication.propertyId))
    .leftJoin(user, eq(user.id, property.assignedUserId))
    .where(and(eq(propertyPublication.id, id), eq(propertyPublication.organizationId, organizationId)));
  if (!r) return null;
  const days = r.pub.expiresAt ? diffDays(ctx.today, r.pub.expiresAt) : null;
  return {
    ...base,
    entity,
    id,
    label: `${propLabel(r.propCode, r.propTitle)} · ${PORTAL_LABELS[r.pub.portal as Portal]}`,
    href: `/properties/${r.pub.propertyId}?tab=publications`,
    facts: { portal: r.pub.portal, level: r.pub.level, daysToExpire: days },
    vars: {
      codigo: r.propCode,
      propiedad: propLabel(r.propCode, r.propTitle),
      responsable: r.assignee ?? "",
      dias: days === null ? "" : String(days),
      estado: PORTAL_LABELS[r.pub.portal as Portal],
    },
    assigneeUserId: r.assignedUserId,
    propertyId: r.pub.propertyId,
  };
}
