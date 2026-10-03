import { and, asc, desc, eq, inArray, isNull, lte, ne, or, sql, type SQL } from "drizzle-orm";
import {
  contact,
  contactChannel,
  deal,
  locality,
  neighborhood,
  property,
  propertyOwner,
  rentalContract,
  rentalContractRent,
  rentalGuarantee,
  user,
  type Db,
  type DbOrTx,
} from "@crm/db";
import {
  ADJUSTMENT_ALERT_DAYS,
  CONTRACT_EXPIRY_ALERT_DAYS,
  CONTRACT_STATUS_LABELS,
  addDaysYmd,
  adjustRent,
  changeBasisPoints,
  contractAlerts,
  contractEnd,
  firstAdjustment,
  formatMoney,
  money,
  nextAdjustmentAfter,
  normalizeText,
  parseMoney,
} from "@crm/shared";
import {
  applyAdjustmentSchema,
  closeContractSchema,
  contractListSchema,
  createContractSchema,
  renewContractSchema,
} from "@crm/shared/validation/rentals";
import { uuidSchema } from "@crm/shared/validation";
import type { ResourceRef } from "@crm/shared/rbac";
import { scopeCondition } from "../access-filter";
import { writeAudit } from "../audit";
import { hasPermission, requirePermission, type RequestContext } from "../context";
import { logActivity, resolveAssignment } from "../crm/helpers";
import { setPropertyStatus } from "../deals/deals";
import { ConflictError, NotFoundError, ValidationError, parseInput } from "../errors";
import { emitEvent } from "../events";
import { propertyDisplayTitle } from "../properties/helpers";
import { nextCode } from "../sequences";

type ContractRow = typeof rentalContract.$inferSelect;

export function contractRef(
  c: Pick<ContractRow, "organizationId" | "assignedUserId" | "branchId" | "teamId">,
): ResourceRef {
  return {
    organizationId: c.organizationId,
    ownerUserId: c.assignedUserId,
    branchId: c.branchId,
    teamId: c.teamId,
  };
}

const fmt = (v: bigint, c: "UYU" | "USD") => formatMoney(money(v, c));
const day = (ymd: string) => ymd.split("-").reverse().join("/");

function contractScope(ctx: RequestContext): SQL {
  return scopeCondition(ctx, "contract.read", {
    ownerUserId: rentalContract.assignedUserId,
    branchId: rentalContract.branchId,
    teamId: rentalContract.teamId,
  });
}

async function loadForWrite(tx: DbOrTx, ctx: RequestContext, id: string) {
  const [c] = await tx
    .select()
    .from(rentalContract)
    .where(
      and(
        eq(rentalContract.id, parseInput(uuidSchema, id)),
        eq(rentalContract.organizationId, ctx.organizationId),
        isNull(rentalContract.deletedAt),
      ),
    )
    .for("update");
  if (!c || !hasPermission(ctx, "contract.read", contractRef(c))) throw new NotFoundError("Contrato");
  requirePermission(ctx, "contract.manage", contractRef(c));
  return c;
}

/** Propiedad libre para el siguiente contrato (si no quedó otro vigente). */
async function releaseProperty(tx: DbOrTx, ctx: RequestContext, c: ContractRow, reason: string) {
  const [other] = await tx
    .select({ id: rentalContract.id })
    .from(rentalContract)
    .where(
      and(
        eq(rentalContract.propertyId, c.propertyId),
        eq(rentalContract.status, "active"),
        ne(rentalContract.id, c.id),
        isNull(rentalContract.deletedAt),
      ),
    );
  const [p] = await tx.select().from(property).where(eq(property.id, c.propertyId));
  if (!other && p?.status === "rented") await setPropertyStatus(tx, ctx, p.id, "available", reason);
}

export async function createContract(db: Db, ctx: RequestContext, rawInput: unknown) {
  requirePermission(ctx, "contract.manage");
  const input = parseInput(createContractSchema, rawInput);
  return db.transaction(async (tx) => {
    const [p] = await tx
      .select()
      .from(property)
      .where(
        and(
          eq(property.id, input.propertyId),
          eq(property.organizationId, ctx.organizationId),
          isNull(property.deletedAt),
        ),
      )
      .for("update");
    if (!p || !hasPermission(ctx, "property.read")) throw new NotFoundError("Propiedad");
    if (!p.operations.includes("rent") && !p.operations.includes("temporary_rent"))
      throw new ValidationError("La propiedad no se ofrece en alquiler", {
        propertyId: ["No es de alquiler"],
      });
    const [busy] = await tx
      .select({ code: rentalContract.code })
      .from(rentalContract)
      .where(
        and(
          eq(rentalContract.propertyId, p.id),
          eq(rentalContract.status, "active"),
          isNull(rentalContract.deletedAt),
        ),
      );
    if (busy) throw new ConflictError(`La propiedad ya tiene el contrato vigente ${busy.code}`);

    const [t] = await tx
      .select()
      .from(contact)
      .where(
        and(
          eq(contact.id, input.tenantContactId),
          eq(contact.organizationId, ctx.organizationId),
          isNull(contact.deletedAt),
        ),
      );
    if (!t) throw new NotFoundError("Inquilino");
    const [owner] = await tx
      .select({ contactId: propertyOwner.contactId })
      .from(propertyOwner)
      .where(and(eq(propertyOwner.propertyId, p.id), eq(propertyOwner.contactId, t.id)));
    if (owner)
      throw new ValidationError("El inquilino es propietario de la propiedad", {
        tenantContactId: ["Inválido"],
      });

    if (input.dealId) {
      const [d] = await tx
        .select()
        .from(deal)
        .where(
          and(eq(deal.id, input.dealId), eq(deal.organizationId, ctx.organizationId), isNull(deal.deletedAt)),
        );
      if (!d || d.propertyId !== p.id || d.clientContactId !== t.id || d.operation === "sale")
        throw new ValidationError("La operación no corresponde a este alquiler", { dealId: ["Inválida"] });
      if (d.stage === "fallen") throw new ConflictError("La operación se cayó");
      const [already] = await tx
        .select({ code: rentalContract.code })
        .from(rentalContract)
        .where(and(eq(rentalContract.dealId, d.id), isNull(rentalContract.deletedAt)));
      if (already) throw new ConflictError(`La operación ya tiene el contrato ${already.code}`);
    }

    const assignedUserId = input.assignedUserId ?? ctx.userId;
    const { branchId, teamId } = await resolveAssignment(tx, ctx.organizationId, assignedUserId);
    requirePermission(ctx, "contract.manage", {
      organizationId: ctx.organizationId,
      ownerUserId: assignedUserId,
      branchId: branchId ?? p.branchId,
      teamId,
    });
    const endDate = contractEnd(input.startDate, input.months);
    const code = await nextCode(tx, ctx.organizationId, "CTR");
    const [row] = await tx
      .insert(rentalContract)
      .values({
        organizationId: ctx.organizationId,
        code,
        propertyId: p.id,
        tenantContactId: t.id,
        dealId: input.dealId,
        startDate: input.startDate,
        endDate,
        currency: input.currency,
        rentMinor: input.rentMinor,
        paymentDay: input.paymentDay,
        adjustmentIndex: input.adjustmentIndex,
        adjustmentMonths: input.adjustmentMonths,
        fixedAdjustmentBasisPoints: input.fixedAdjustmentBasisPoints,
        nextAdjustmentAt: firstAdjustment(
          input.startDate,
          endDate,
          input.adjustmentIndex,
          input.adjustmentMonths,
        ),
        depositMinor: input.depositMinor,
        depositCurrency: input.depositMinor !== null ? (input.depositCurrency ?? input.currency) : null,
        adminFeeBasisPoints: input.adminFeeBasisPoints,
        guaranteeNote: input.guaranteeNote,
        notes: input.notes,
        assignedUserId,
        branchId: branchId ?? p.branchId,
        teamId,
        createdById: ctx.userId,
      })
      .returning();
    if (!row) throw new Error("No se pudo crear el contrato");
    await tx.insert(rentalContractRent).values({
      organizationId: ctx.organizationId,
      contractId: row.id,
      effectiveFrom: input.startDate,
      currency: input.currency,
      amountMinor: input.rentMinor,
      reason: "initial",
      actorUserId: ctx.userId,
    });
    await setPropertyStatus(tx, ctx, p.id, "rented", `Contrato ${code}`);
    await logActivity(tx, ctx, {
      type: "document",
      contactId: t.id,
      body: `Contrato ${code}: ${propertyDisplayTitle(p)} · ${fmt(input.rentMinor, input.currency)} por mes, del ${day(input.startDate)} al ${day(endDate)}`,
      payload: { contractId: row.id, propertyId: p.id },
    });
    await writeAudit(tx, ctx, {
      action: "contract.create",
      entityType: "rental_contract",
      entityId: row.id,
      after: row,
    });
    await emitEvent(tx, ctx, {
      type: "contract.created",
      aggregateType: "rental_contract",
      aggregateId: row.id,
      payload: { propertyId: p.id, tenantContactId: t.id, endDate },
    });
    return row;
  });
}

/** Ajuste del alquiler (índice, porcentaje fijo o acuerdo). Queda en el historial. */
export async function applyAdjustment(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(applyAdjustmentSchema, rawInput);
  return db.transaction(async (tx) => {
    const c = await loadForWrite(tx, ctx, input.contractId);
    if (c.status !== "active") throw new ConflictError("El contrato no está vigente");
    if (input.effectiveFrom < c.startDate || input.effectiveFrom > c.endDate)
      throw new ValidationError("La fecha está fuera del plazo del contrato", {
        effectiveFrom: ["Fuera de plazo"],
      });
    let amount: bigint;
    let bp: number;
    if (input.newRent) {
      try {
        amount = parseMoney(input.newRent, c.currency).amountMinor;
      } catch {
        throw new ValidationError("Importe inválido", { newRent: ["Importe inválido"] });
      }
      if (amount <= 0n) throw new ValidationError("Importe inválido", { newRent: ["Importe inválido"] });
      bp = changeBasisPoints(c.rentMinor, amount);
    } else {
      bp = input.basisPoints ?? 0;
      amount = adjustRent(c.rentMinor, bp);
    }
    if (amount === c.rentMinor) throw new ConflictError("El alquiler no cambia");
    const isScheduled =
      c.nextAdjustmentAt !== null && input.effectiveFrom >= addDaysYmd(c.nextAdjustmentAt, -45);
    const next =
      isScheduled && c.nextAdjustmentAt
        ? nextAdjustmentAfter(c.nextAdjustmentAt, c.endDate, c.adjustmentMonths)
        : c.nextAdjustmentAt;
    const [after] = await tx
      .update(rentalContract)
      .set({ rentMinor: amount, nextAdjustmentAt: next })
      .where(eq(rentalContract.id, c.id))
      .returning();
    await tx.insert(rentalContractRent).values({
      organizationId: ctx.organizationId,
      contractId: c.id,
      effectiveFrom: input.effectiveFrom,
      currency: c.currency,
      amountMinor: amount,
      reason: isScheduled ? "adjustment" : "agreement",
      basisPoints: bp,
      note: input.note,
      actorUserId: ctx.userId,
    });
    await logActivity(tx, ctx, {
      type: "note",
      contactId: c.tenantContactId,
      body: `Contrato ${c.code}: alquiler de ${fmt(c.rentMinor, c.currency)} a ${fmt(amount, c.currency)} desde el ${day(input.effectiveFrom)}${input.note ? ` · ${input.note}` : ""}`,
      payload: { contractId: c.id },
    });
    await writeAudit(tx, ctx, {
      action: "contract.adjust",
      entityType: "rental_contract",
      entityId: c.id,
      before: { rentMinor: c.rentMinor, nextAdjustmentAt: c.nextAdjustmentAt },
      after: {
        rentMinor: amount,
        basisPoints: bp,
        effectiveFrom: input.effectiveFrom,
        nextAdjustmentAt: next,
      },
    });
    await emitEvent(tx, ctx, {
      type: "contract.adjusted",
      aggregateType: "rental_contract",
      aggregateId: c.id,
      payload: { basisPoints: bp, effectiveFrom: input.effectiveFrom },
    });
    return after;
  });
}

/** Renueva: el contrato actual queda "renovado" y nace uno nuevo desde el día siguiente al fin. */
export async function renewContract(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(renewContractSchema, rawInput);
  return db.transaction(async (tx) => {
    const c = await loadForWrite(tx, ctx, input.contractId);
    if (c.status !== "active") throw new ConflictError("Solo se renueva un contrato vigente");
    let rent = c.rentMinor;
    if (input.newRent) {
      try {
        rent = parseMoney(input.newRent, c.currency).amountMinor;
      } catch {
        throw new ValidationError("Importe inválido", { newRent: ["Importe inválido"] });
      }
      if (rent <= 0n) throw new ValidationError("Importe inválido", { newRent: ["Importe inválido"] });
    }
    await tx
      .update(rentalContract)
      .set({ status: "renewed", closedAt: c.endDate, closeReason: input.note ?? "Renovación" })
      .where(eq(rentalContract.id, c.id));
    const startDate = addDaysYmd(c.endDate, 1);
    const endDate = contractEnd(startDate, input.months);
    const code = await nextCode(tx, ctx.organizationId, "CTR");
    const [row] = await tx
      .insert(rentalContract)
      .values({
        organizationId: ctx.organizationId,
        code,
        propertyId: c.propertyId,
        tenantContactId: c.tenantContactId,
        dealId: null,
        renewedFromId: c.id,
        startDate,
        endDate,
        currency: c.currency,
        rentMinor: rent,
        paymentDay: c.paymentDay,
        adjustmentIndex: c.adjustmentIndex,
        adjustmentMonths: c.adjustmentMonths,
        fixedAdjustmentBasisPoints: c.fixedAdjustmentBasisPoints,
        nextAdjustmentAt: firstAdjustment(startDate, endDate, c.adjustmentIndex, c.adjustmentMonths),
        depositMinor: c.depositMinor,
        depositCurrency: c.depositCurrency,
        adminFeeBasisPoints: c.adminFeeBasisPoints,
        guaranteeNote: c.guaranteeNote,
        notes: c.notes,
        assignedUserId: c.assignedUserId,
        branchId: c.branchId,
        teamId: c.teamId,
        createdById: ctx.userId,
      })
      .returning();
    if (!row) throw new Error("No se pudo renovar");
    // Las garantías del contrato siguen con la renovación (se controla su vencimiento aparte).
    await tx
      .update(rentalGuarantee)
      .set({ contractId: row.id })
      .where(
        and(
          eq(rentalGuarantee.contractId, c.id),
          inArray(rentalGuarantee.status, ["active", "approved", "in_process", "expired"]),
          isNull(rentalGuarantee.deletedAt),
        ),
      );
    await tx.insert(rentalContractRent).values({
      organizationId: ctx.organizationId,
      contractId: row.id,
      effectiveFrom: startDate,
      currency: c.currency,
      amountMinor: rent,
      reason: "renewal",
      basisPoints: changeBasisPoints(c.rentMinor, rent),
      note: input.note,
      actorUserId: ctx.userId,
    });
    await logActivity(tx, ctx, {
      type: "document",
      contactId: c.tenantContactId,
      body: `Contrato ${c.code} renovado como ${code}: del ${day(startDate)} al ${day(endDate)}, ${fmt(rent, c.currency)} por mes`,
      payload: { contractId: row.id, renewedFromId: c.id },
    });
    await writeAudit(tx, ctx, {
      action: "contract.renew",
      entityType: "rental_contract",
      entityId: c.id,
      before: { status: c.status, endDate: c.endDate, rentMinor: c.rentMinor },
      after: { renewedAs: row.id, code, startDate, endDate, rentMinor: rent },
    });
    await emitEvent(tx, ctx, {
      type: "contract.renewed",
      aggregateType: "rental_contract",
      aggregateId: row.id,
      payload: { renewedFromId: c.id, endDate },
    });
    return row;
  });
}

/** Finaliza (al vencer) o rescinde (antes). La propiedad vuelve a estar disponible. */
export async function closeContract(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(closeContractSchema, rawInput);
  return db.transaction(async (tx) => {
    const c = await loadForWrite(tx, ctx, input.contractId);
    if (c.status !== "active") throw new ConflictError("El contrato no está vigente");
    if (input.date < c.startDate)
      throw new ValidationError("La fecha es anterior al inicio", { date: ["Anterior al inicio"] });
    if (input.kind === "terminated" && !input.reason)
      throw new ValidationError("Indicá el motivo de la rescisión", { reason: ["Requerido"] });
    const [after] = await tx
      .update(rentalContract)
      .set({ status: input.kind, closedAt: input.date, closeReason: input.reason })
      .where(eq(rentalContract.id, c.id))
      .returning();
    await releaseProperty(
      tx,
      ctx,
      c,
      `Contrato ${c.code} ${CONTRACT_STATUS_LABELS[input.kind].toLowerCase()}`,
    );
    // Sin contrato vigente, sus garantías quedan liberadas.
    await tx
      .update(rentalGuarantee)
      .set({
        status: "released",
        statusNote: `Contrato ${c.code} ${CONTRACT_STATUS_LABELS[input.kind].toLowerCase()}`,
      })
      .where(
        and(
          eq(rentalGuarantee.contractId, c.id),
          inArray(rentalGuarantee.status, ["active", "expired"]),
          isNull(rentalGuarantee.deletedAt),
        ),
      );
    await logActivity(tx, ctx, {
      type: "document",
      contactId: c.tenantContactId,
      body: `Contrato ${c.code} ${CONTRACT_STATUS_LABELS[input.kind].toLowerCase()} el ${day(input.date)}${input.reason ? ` · ${input.reason}` : ""}`,
      payload: { contractId: c.id },
    });
    await writeAudit(tx, ctx, {
      action: `contract.${input.kind}`,
      entityType: "rental_contract",
      entityId: c.id,
      before: { status: c.status },
      after: { status: input.kind, closedAt: input.date, reason: input.reason },
    });
    await emitEvent(tx, ctx, {
      type: `contract.${input.kind}`,
      aggregateType: "rental_contract",
      aggregateId: c.id,
      payload: { propertyId: c.propertyId },
    });
    return after;
  });
}

// ---------------------------------------------------------------------------------------------
// Lecturas
// ---------------------------------------------------------------------------------------------

export async function listContracts(db: DbOrTx, ctx: RequestContext, rawQuery: unknown, today: string) {
  requirePermission(ctx, "contract.read");
  const q = parseInput(contractListSchema, rawQuery);
  const soon = addDaysYmd(today, CONTRACT_EXPIRY_ALERT_DAYS);
  const soonAdj = addDaysYmd(today, ADJUSTMENT_ALERT_DAYS);
  const conditions: (SQL | undefined)[] = [
    eq(rentalContract.organizationId, ctx.organizationId),
    isNull(rentalContract.deletedAt),
    contractScope(ctx),
    q.propertyId ? eq(rentalContract.propertyId, q.propertyId) : undefined,
  ];
  if (q.status === "active") conditions.push(eq(rentalContract.status, "active"));
  else if (q.status === "closed") conditions.push(ne(rentalContract.status, "active"));
  else if (q.status === "expiring")
    conditions.push(
      and(
        eq(rentalContract.status, "active"),
        or(lte(rentalContract.endDate, soon), lte(rentalContract.nextAdjustmentAt, soonAdj)),
      ),
    );
  if (q.q) {
    const term = `%${normalizeText(q.q)}%`;
    conditions.push(
      sql`(lower(${rentalContract.code}) like ${term} or lower(${property.code}) like ${term} or lower(unaccent(coalesce(${property.title}, ''))) like ${term} or lower(unaccent(coalesce(${property.address}, ''))) like ${term} or lower(unaccent(${contact.displayName})) like ${term})`,
    );
  }
  const rows = await db
    .select({
      c: rentalContract,
      propertyCode: property.code,
      propertyTitle: property.title,
      propertyType: property.type,
      propertyAddress: property.address,
      zone: sql<string | null>`nullif(concat_ws(', ', ${neighborhood.name}, ${locality.name}), '')`,
      tenantName: contact.displayName,
      assignedName: user.name,
    })
    .from(rentalContract)
    .innerJoin(property, eq(property.id, rentalContract.propertyId))
    .innerJoin(contact, eq(contact.id, rentalContract.tenantContactId))
    .leftJoin(user, eq(user.id, rentalContract.assignedUserId))
    .leftJoin(locality, eq(locality.id, property.localityId))
    .leftJoin(neighborhood, eq(neighborhood.id, property.neighborhoodId))
    .where(and(...conditions))
    .orderBy(
      sql`case when ${rentalContract.status} = 'active' then 0 else 1 end`,
      asc(rentalContract.endDate),
    )
    .limit(300);

  const propertyIds = [...new Set(rows.map((r) => r.c.propertyId))];
  const owners = propertyIds.length
    ? await db
        .select({ propertyId: propertyOwner.propertyId, name: contact.displayName })
        .from(propertyOwner)
        .innerJoin(contact, eq(contact.id, propertyOwner.contactId))
        .where(inArray(propertyOwner.propertyId, propertyIds))
        .orderBy(desc(propertyOwner.shareBasisPoints))
    : [];
  const [counts] = await db
    .select({
      active: sql<number>`count(*) filter (where ${rentalContract.status} = 'active')::int`,
      expiring: sql<number>`count(*) filter (where ${rentalContract.status} = 'active' and ${rentalContract.endDate} <= ${soon})::int`,
      adjustments: sql<number>`count(*) filter (where ${rentalContract.status} = 'active' and ${rentalContract.nextAdjustmentAt} <= ${soonAdj})::int`,
    })
    .from(rentalContract)
    .where(
      and(
        eq(rentalContract.organizationId, ctx.organizationId),
        isNull(rentalContract.deletedAt),
        contractScope(ctx),
      ),
    );

  return {
    items: rows.map((r) => ({
      ...r.c,
      propertyCode: r.propertyCode,
      propertyLabel: propertyDisplayTitle({
        title: r.propertyTitle,
        type: r.propertyType,
        code: r.propertyCode,
      }),
      propertyAddress: r.propertyAddress,
      zone: r.zone,
      tenantName: r.tenantName,
      ownerNames: owners.filter((o) => o.propertyId === r.c.propertyId).map((o) => o.name),
      assignedName: r.assignedName,
      alerts: contractAlerts(r.c, today),
    })),
    counts: counts ?? { active: 0, expiring: 0, adjustments: 0 },
    canManage: hasPermission(ctx, "contract.manage"),
  };
}

export async function getContract(db: DbOrTx, ctx: RequestContext, contractId: string, today: string) {
  const id = parseInput(uuidSchema, contractId);
  const [row] = await db
    .select({
      c: rentalContract,
      p: property,
      tenantName: contact.displayName,
      assignedName: user.name,
      zone: sql<string | null>`nullif(concat_ws(', ', ${neighborhood.name}, ${locality.name}), '')`,
    })
    .from(rentalContract)
    .innerJoin(property, eq(property.id, rentalContract.propertyId))
    .innerJoin(contact, eq(contact.id, rentalContract.tenantContactId))
    .leftJoin(user, eq(user.id, rentalContract.assignedUserId))
    .leftJoin(locality, eq(locality.id, property.localityId))
    .leftJoin(neighborhood, eq(neighborhood.id, property.neighborhoodId))
    .where(
      and(
        eq(rentalContract.id, id),
        eq(rentalContract.organizationId, ctx.organizationId),
        isNull(rentalContract.deletedAt),
      ),
    );
  if (!row || !hasPermission(ctx, "contract.read", contractRef(row.c))) throw new NotFoundError("Contrato");
  const [rents, owners, chain, dealRow, phones] = await Promise.all([
    db
      .select({ r: rentalContractRent, actorName: user.name })
      .from(rentalContractRent)
      .leftJoin(user, eq(user.id, rentalContractRent.actorUserId))
      .where(
        inArray(
          rentalContractRent.contractId,
          // Historial de toda la cadena de renovaciones.
          sql`(with recursive ch(id, prev) as (select id, renewed_from_id from rental_contract where id = ${id} union all select r.id, r.renewed_from_id from rental_contract r join ch on r.id = ch.prev) select id from ch)`,
        ),
      )
      .orderBy(desc(rentalContractRent.effectiveFrom), desc(rentalContractRent.createdAt)),
    db
      .select({
        contactId: propertyOwner.contactId,
        name: contact.displayName,
        share: propertyOwner.shareBasisPoints,
      })
      .from(propertyOwner)
      .innerJoin(contact, eq(contact.id, propertyOwner.contactId))
      .where(eq(propertyOwner.propertyId, row.c.propertyId))
      .orderBy(desc(propertyOwner.shareBasisPoints)),
    db
      .select({
        id: rentalContract.id,
        code: rentalContract.code,
        status: rentalContract.status,
        startDate: rentalContract.startDate,
        endDate: rentalContract.endDate,
        renewedFromId: rentalContract.renewedFromId,
      })
      .from(rentalContract)
      .where(
        and(
          eq(rentalContract.propertyId, row.c.propertyId),
          eq(rentalContract.tenantContactId, row.c.tenantContactId),
          isNull(rentalContract.deletedAt),
        ),
      )
      .orderBy(asc(rentalContract.startDate)),
    row.c.dealId
      ? db.select({ id: deal.id, code: deal.code }).from(deal).where(eq(deal.id, row.c.dealId))
      : Promise.resolve([]),
    db
      .select({ normalized: contactChannel.normalized })
      .from(contactChannel)
      .where(and(eq(contactChannel.contactId, row.c.tenantContactId), ne(contactChannel.type, "email")))
      .orderBy(desc(contactChannel.isPrimary))
      .limit(1),
  ]);
  return {
    contract: row.c,
    property: {
      id: row.p.id,
      code: row.p.code,
      label: propertyDisplayTitle(row.p),
      address: row.p.address,
      zone: row.zone,
      status: row.p.status,
    },
    tenantName: row.tenantName,
    tenantPhone: phones[0]?.normalized ?? null,
    assignedName: row.assignedName,
    owners,
    rents: rents.map((x) => ({ ...x.r, actorName: x.actorName })),
    chain,
    deal: dealRow[0] ?? null,
    alerts: contractAlerts(row.c, today),
    canManage: hasPermission(ctx, "contract.manage", contractRef(row.c)),
  };
}

/** Avisos para el dashboard y la bandeja de renovaciones. */
export async function rentalAlerts(db: DbOrTx, ctx: RequestContext, today: string) {
  if (!hasPermission(ctx, "contract.read")) return null;
  const r = await listContracts(db, ctx, { status: "expiring" }, today);
  return {
    expiring: r.items.filter((i) => i.alerts.includes("expiring") || i.alerts.includes("expired")),
    adjustments: r.items.filter(
      (i) => i.alerts.includes("adjustment_due") || i.alerts.includes("adjustment_overdue"),
    ),
  };
}

/** Contrato vigente de una propiedad (para su ficha). */
export async function activeContractFor(db: DbOrTx, ctx: RequestContext, propertyId: string) {
  if (!hasPermission(ctx, "contract.read")) return null;
  const [c] = await db
    .select({
      id: rentalContract.id,
      code: rentalContract.code,
      endDate: rentalContract.endDate,
      rentMinor: rentalContract.rentMinor,
      currency: rentalContract.currency,
      tenantName: contact.displayName,
    })
    .from(rentalContract)
    .innerJoin(contact, eq(contact.id, rentalContract.tenantContactId))
    .where(
      and(
        eq(rentalContract.propertyId, parseInput(uuidSchema, propertyId)),
        eq(rentalContract.organizationId, ctx.organizationId),
        eq(rentalContract.status, "active"),
        isNull(rentalContract.deletedAt),
        contractScope(ctx),
      ),
    );
  return c ?? null;
}

/** Contrato ya creado desde una operación (para no duplicar). */
export async function contractForDeal(db: DbOrTx, ctx: RequestContext, dealId: string) {
  if (!hasPermission(ctx, "contract.read")) return null;
  const [c] = await db
    .select({ id: rentalContract.id, code: rentalContract.code })
    .from(rentalContract)
    .where(
      and(
        eq(rentalContract.dealId, parseInput(uuidSchema, dealId)),
        eq(rentalContract.organizationId, ctx.organizationId),
        isNull(rentalContract.deletedAt),
      ),
    );
  return c ?? null;
}

export type ContractListItem = Awaited<ReturnType<typeof listContracts>>["items"][number];
