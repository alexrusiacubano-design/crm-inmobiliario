import { and, desc, eq, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  contact,
  deal,
  property,
  rentalContract,
  rentalGuarantee,
  user,
  type Db,
  type DbOrTx,
} from "@crm/db";
import {
  GUARANTEE_EXPIRY_ALERT_DAYS,
  GUARANTEE_REQUIREMENTS,
  GUARANTEE_STATUS_LABELS,
  GUARANTEE_TYPE_LABELS,
  addDaysYmd,
  canTransitionGuarantee,
  guaranteeAlerts,
  type GuaranteeStatus,
} from "@crm/shared";
import {
  createGuaranteeSchema,
  guaranteeListSchema,
  guaranteeRequirementSchema,
  guaranteeStatusSchema,
  updateGuaranteeSchema,
} from "@crm/shared/validation/guarantees";
import type { ResourceRef } from "@crm/shared/rbac";
import { scopeCondition } from "../access-filter";
import { writeAudit } from "../audit";
import { hasPermission, requirePermission, type RequestContext } from "../context";
import { logActivity, resolveAssignment } from "../crm/helpers";
import { ConflictError, NotFoundError, ValidationError, parseInput } from "../errors";
import { emitEvent } from "../events";
import { propertyDisplayTitle } from "../properties/helpers";

type GuaranteeRow = typeof rentalGuarantee.$inferSelect;

function guaranteeRef(
  g: Pick<GuaranteeRow, "organizationId" | "assignedUserId" | "branchId" | "teamId">,
): ResourceRef {
  return {
    organizationId: g.organizationId,
    ownerUserId: g.assignedUserId,
    branchId: g.branchId,
    teamId: g.teamId,
  };
}

function scope(ctx: RequestContext): SQL {
  return scopeCondition(ctx, "guarantee.read", {
    ownerUserId: rentalGuarantee.assignedUserId,
    branchId: rentalGuarantee.branchId,
    teamId: rentalGuarantee.teamId,
  });
}

async function loadForWrite(tx: DbOrTx, ctx: RequestContext, id: string) {
  const [g] = await tx
    .select()
    .from(rentalGuarantee)
    .where(
      and(
        eq(rentalGuarantee.id, id),
        eq(rentalGuarantee.organizationId, ctx.organizationId),
        isNull(rentalGuarantee.deletedAt),
      ),
    )
    .for("update");
  if (!g || !hasPermission(ctx, "guarantee.read", guaranteeRef(g))) throw new NotFoundError("Garantía");
  requirePermission(ctx, "guarantee.manage", guaranteeRef(g));
  return g;
}

async function checkContract(tx: DbOrTx, ctx: RequestContext, contractId: string, tenantContactId: string) {
  const [c] = await tx
    .select()
    .from(rentalContract)
    .where(
      and(
        eq(rentalContract.id, contractId),
        eq(rentalContract.organizationId, ctx.organizationId),
        isNull(rentalContract.deletedAt),
      ),
    );
  if (!c || c.tenantContactId !== tenantContactId)
    throw new ValidationError("El contrato no corresponde al inquilino", { contractId: ["Inválido"] });
  return c;
}

async function checkContact(tx: DbOrTx, ctx: RequestContext, id: string, label: string) {
  const [c] = await tx
    .select({ id: contact.id })
    .from(contact)
    .where(
      and(eq(contact.id, id), eq(contact.organizationId, ctx.organizationId), isNull(contact.deletedAt)),
    );
  if (!c) throw new NotFoundError(label);
}

export async function createGuarantee(db: Db, ctx: RequestContext, rawInput: unknown, today: string) {
  requirePermission(ctx, "guarantee.manage");
  const input = parseInput(createGuaranteeSchema, rawInput);
  return db.transaction(async (tx) => {
    await checkContact(tx, ctx, input.tenantContactId, "Inquilino");
    if (input.guarantorContactId) await checkContact(tx, ctx, input.guarantorContactId, "Fiador");
    if (input.contractId) await checkContract(tx, ctx, input.contractId, input.tenantContactId);
    if (input.dealId) {
      const [d] = await tx
        .select()
        .from(deal)
        .where(and(eq(deal.id, input.dealId), eq(deal.organizationId, ctx.organizationId)));
      if (!d || d.clientContactId !== input.tenantContactId || d.operation === "sale")
        throw new ValidationError("La operación no corresponde", { dealId: ["Inválida"] });
    }
    if (input.guarantorContactId && input.type !== "property_guarantor" && input.type !== "other")
      throw new ValidationError("El fiador solo aplica a garantía propietaria", {
        guarantorContactId: ["No aplica"],
      });
    const { branchId, teamId } = await resolveAssignment(tx, ctx.organizationId, ctx.userId);
    const [row] = await tx
      .insert(rentalGuarantee)
      .values({
        organizationId: ctx.organizationId,
        tenantContactId: input.tenantContactId,
        contractId: input.contractId,
        dealId: input.dealId,
        type: input.type,
        provider: input.provider,
        reference: input.reference,
        currency: input.currency,
        coverageMinor: input.coverageMinor,
        requestedAt: today,
        validFrom: input.validFrom,
        validUntil: input.validUntil,
        depositPlace: input.type === "deposit" ? (input.depositPlace ?? "bhu") : null,
        guarantorContactId: input.guarantorContactId,
        requirements: GUARANTEE_REQUIREMENTS[input.type].map((label) => ({ label, done: false })),
        notes: input.notes,
        assignedUserId: ctx.userId,
        branchId,
        teamId,
        createdById: ctx.userId,
      })
      .returning();
    if (!row) throw new Error("No se pudo registrar la garantía");
    await logActivity(tx, ctx, {
      type: "document",
      contactId: input.tenantContactId,
      body: `Garantía ${GUARANTEE_TYPE_LABELS[input.type]} en trámite${input.provider ? ` · ${input.provider}` : ""}`,
      payload: { guaranteeId: row.id },
    });
    await writeAudit(tx, ctx, {
      action: "guarantee.create",
      entityType: "rental_guarantee",
      entityId: row.id,
      after: row,
    });
    await emitEvent(tx, ctx, {
      type: "guarantee.created",
      aggregateType: "rental_guarantee",
      aggregateId: row.id,
      payload: { type: input.type, contractId: input.contractId },
    });
    return row;
  });
}

export async function updateGuarantee(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(updateGuaranteeSchema, rawInput);
  return db.transaction(async (tx) => {
    const g = await loadForWrite(tx, ctx, input.id);
    if (g.status === "released") throw new ConflictError("La garantía está liberada");
    if (input.guarantorContactId) await checkContact(tx, ctx, input.guarantorContactId, "Fiador");
    const typeChanged = input.type !== g.type;
    if (typeChanged && g.status !== "in_process")
      throw new ConflictError("El tipo solo se cambia mientras está en trámite");
    const [after] = await tx
      .update(rentalGuarantee)
      .set({
        type: input.type,
        provider: input.provider,
        reference: input.reference,
        currency: input.currency,
        coverageMinor: input.coverageMinor,
        validFrom: input.validFrom,
        validUntil: input.validUntil,
        depositPlace: input.type === "deposit" ? (input.depositPlace ?? g.depositPlace ?? "bhu") : null,
        guarantorContactId: input.guarantorContactId,
        notes: input.notes,
        ...(typeChanged
          ? { requirements: GUARANTEE_REQUIREMENTS[input.type].map((label) => ({ label, done: false })) }
          : {}),
      })
      .where(eq(rentalGuarantee.id, g.id))
      .returning();
    await writeAudit(tx, ctx, {
      action: "guarantee.update",
      entityType: "rental_guarantee",
      entityId: g.id,
      before: g,
      after,
    });
    return after;
  });
}

/** Cambio de estado del trámite. Vigente exige contrato y fecha de vencimiento. */
export async function changeGuaranteeStatus(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(guaranteeStatusSchema, rawInput);
  return db.transaction(async (tx) => {
    const g = await loadForWrite(tx, ctx, input.id);
    if (!canTransitionGuarantee(g.status, input.status))
      throw new ConflictError(
        `No se puede pasar de ${GUARANTEE_STATUS_LABELS[g.status]} a ${GUARANTEE_STATUS_LABELS[input.status]}`,
      );
    let contractId = g.contractId;
    if (input.contractId && input.contractId !== g.contractId) {
      await checkContract(tx, ctx, input.contractId, g.tenantContactId);
      contractId = input.contractId;
    }
    if (input.status === "active") {
      if (!contractId)
        throw new ValidationError("Vinculala a un contrato para darla por vigente", {
          contractId: ["Requerido"],
        });
      if (g.requirements.some((r) => !r.done))
        throw new ConflictError("Faltan requisitos: tildalos antes de darla por vigente");
    }
    if (input.status === "rejected" && !input.note)
      throw new ValidationError("Indicá el motivo del rechazo", { note: ["Requerido"] });
    const [after] = await tx
      .update(rentalGuarantee)
      .set({ status: input.status, statusNote: input.note, contractId })
      .where(eq(rentalGuarantee.id, g.id))
      .returning();
    await logActivity(tx, ctx, {
      type: "document",
      contactId: g.tenantContactId,
      body: `Garantía ${GUARANTEE_TYPE_LABELS[g.type]}: ${GUARANTEE_STATUS_LABELS[input.status].toLowerCase()}${input.note ? ` · ${input.note}` : ""}`,
      payload: { guaranteeId: g.id, from: g.status, to: input.status },
    });
    await writeAudit(tx, ctx, {
      action: "guarantee.status",
      entityType: "rental_guarantee",
      entityId: g.id,
      before: { status: g.status },
      after: { status: input.status, note: input.note, contractId },
    });
    await emitEvent(tx, ctx, {
      type: `guarantee.${input.status}`,
      aggregateType: "rental_guarantee",
      aggregateId: g.id,
      payload: { contractId },
    });
    return after;
  });
}

/** Tildar / destildar un requisito, o agregar uno nuevo (con `label`). */
export async function setGuaranteeRequirement(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(guaranteeRequirementSchema, rawInput);
  return db.transaction(async (tx) => {
    const g = await loadForWrite(tx, ctx, input.id);
    const reqs = [...g.requirements];
    if (input.label) reqs.push({ label: input.label, done: input.done });
    else {
      const r = reqs[input.index];
      if (!r) throw new NotFoundError("Requisito");
      reqs[input.index] = { ...r, done: input.done };
    }
    const [after] = await tx
      .update(rentalGuarantee)
      .set({ requirements: reqs })
      .where(eq(rentalGuarantee.id, g.id))
      .returning();
    await writeAudit(tx, ctx, {
      action: "guarantee.requirement",
      entityType: "rental_guarantee",
      entityId: g.id,
      before: g.requirements,
      after: reqs,
    });
    return after;
  });
}

const tenant = alias(contact, "tenant");
const guarantor = alias(contact, "guarantor");

export async function listGuarantees(db: DbOrTx, ctx: RequestContext, rawQuery: unknown, today: string) {
  requirePermission(ctx, "guarantee.read");
  const q = parseInput(guaranteeListSchema, rawQuery);
  const soon = addDaysYmd(today, GUARANTEE_EXPIRY_ALERT_DAYS);
  const conditions: (SQL | undefined)[] = [
    eq(rentalGuarantee.organizationId, ctx.organizationId),
    isNull(rentalGuarantee.deletedAt),
    scope(ctx),
    q.type ? eq(rentalGuarantee.type, q.type) : undefined,
    q.contractId ? eq(rentalGuarantee.contractId, q.contractId) : undefined,
    q.tenantContactId ? eq(rentalGuarantee.tenantContactId, q.tenantContactId) : undefined,
  ];
  if (q.status === "in_process")
    conditions.push(inArray(rentalGuarantee.status, ["in_process", "approved"] as GuaranteeStatus[]));
  else if (q.status === "active") conditions.push(eq(rentalGuarantee.status, "active"));
  else if (q.status === "closed")
    conditions.push(
      inArray(rentalGuarantee.status, ["rejected", "expired", "released"] as GuaranteeStatus[]),
    );
  else if (q.status === "alerts")
    conditions.push(
      or(
        and(eq(rentalGuarantee.status, "active"), lte(rentalGuarantee.validUntil, soon)),
        eq(rentalGuarantee.status, "in_process"),
        eq(rentalGuarantee.status, "approved"),
      ),
    );
  const rows = await db
    .select({
      g: rentalGuarantee,
      tenantName: tenant.displayName,
      guarantorName: guarantor.displayName,
      contractCode: rentalContract.code,
      contractEnd: rentalContract.endDate,
      propertyCode: property.code,
      propertyTitle: property.title,
      propertyType: property.type,
      propertyAddress: property.address,
      assignedName: user.name,
    })
    .from(rentalGuarantee)
    .innerJoin(tenant, eq(tenant.id, rentalGuarantee.tenantContactId))
    .leftJoin(guarantor, eq(guarantor.id, rentalGuarantee.guarantorContactId))
    .leftJoin(rentalContract, eq(rentalContract.id, rentalGuarantee.contractId))
    .leftJoin(property, eq(property.id, rentalContract.propertyId))
    .leftJoin(user, eq(user.id, rentalGuarantee.assignedUserId))
    .where(and(...conditions))
    .orderBy(
      sql`case ${rentalGuarantee.status} when 'in_process' then 0 when 'approved' then 1 when 'active' then 2 else 3 end`,
      sql`${rentalGuarantee.validUntil} asc nulls last`,
      desc(rentalGuarantee.createdAt),
    )
    .limit(300);
  const items = rows
    .map((r) => ({
      ...r.g,
      tenantName: r.tenantName,
      guarantorName: r.guarantorName,
      contractCode: r.contractCode,
      contractEnd: r.contractEnd,
      propertyLabel: r.propertyCode
        ? r.propertyAddress ||
          propertyDisplayTitle({
            title: r.propertyTitle,
            type: r.propertyType ?? "apartment",
            code: r.propertyCode,
          })
        : null,
      assignedName: r.assignedName,
      alerts: guaranteeAlerts(r.g, today),
      // La garantía tiene que cubrir hasta el fin del contrato.
      shortOfContract: Boolean(
        r.g.status === "active" && r.g.validUntil && r.contractEnd && r.g.validUntil < r.contractEnd,
      ),
    }))
    .filter((i) => q.status !== "alerts" || i.alerts.length > 0 || i.shortOfContract);

  const [counts] = await db
    .select({
      inProcess: sql<number>`count(*) filter (where ${rentalGuarantee.status} in ('in_process','approved'))::int`,
      active: sql<number>`count(*) filter (where ${rentalGuarantee.status} = 'active')::int`,
      expiring: sql<number>`count(*) filter (where ${rentalGuarantee.status} = 'active' and ${rentalGuarantee.validUntil} <= ${soon})::int`,
    })
    .from(rentalGuarantee)
    .where(
      and(
        eq(rentalGuarantee.organizationId, ctx.organizationId),
        isNull(rentalGuarantee.deletedAt),
        scope(ctx),
      ),
    );
  return {
    items,
    counts: counts ?? { inProcess: 0, active: 0, expiring: 0 },
    canManage: hasPermission(ctx, "guarantee.manage"),
  };
}

/** Contratos vigentes sin ninguna garantía vigente (para el aviso de la bandeja). */
export async function contractsWithoutGuarantee(db: DbOrTx, ctx: RequestContext) {
  if (!hasPermission(ctx, "guarantee.read") || !hasPermission(ctx, "contract.read")) return [];
  return db
    .select({ id: rentalContract.id, code: rentalContract.code, tenantName: contact.displayName })
    .from(rentalContract)
    .innerJoin(contact, eq(contact.id, rentalContract.tenantContactId))
    .where(
      and(
        eq(rentalContract.organizationId, ctx.organizationId),
        eq(rentalContract.status, "active"),
        isNull(rentalContract.deletedAt),
        sql`not exists (select 1 from rental_guarantee g where g.contract_id = ${rentalContract.id} and g.status = 'active' and g.deleted_at is null)`,
      ),
    )
    .orderBy(rentalContract.code);
}
