import { and, asc, count, desc, eq, inArray, isNull, lte, sql, type SQL } from "drizzle-orm";
import {
  acquisition,
  contact,
  locality,
  neighborhood,
  ownerProfile,
  property,
  propertyOwner,
  propertyPrice,
  user,
  valuation,
  type Db,
  type DbOrTx,
} from "@crm/db";
import {
  ACQUISITION_STAGE_LABELS,
  canTransitionAcquisition,
  normalizeText,
  OPEN_ACQUISITION_STAGES,
  parseMoney,
  parsePercentToBasisPoints,
} from "@crm/shared";
import { SCOPE_RANK, widestScope, type ResourceRef } from "@crm/shared/rbac";
import {
  acquisitionInputSchema,
  acquisitionListSchema,
  acquisitionStageSchema,
  updateAcquisitionSchema,
  valuationInputSchema,
} from "@crm/shared/validation/property";
import { listQuerySchema, uuidSchema } from "@crm/shared/validation";
import { scopeCondition } from "../access-filter";
import { writeAudit } from "../audit";
import { hasPermission, requirePermission, type RequestContext } from "../context";
import { contactRef, logActivity, resolveAssignment } from "../crm/helpers";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, parseInput } from "../errors";
import { emitEvent } from "../events";
import { nextCode } from "../sequences";
import { propertyDisplayTitle, propertyRef, syncPropertySearch } from "./helpers";
import { insertProperty } from "./properties";

type AcqRow = typeof acquisition.$inferSelect;
type AcqInput = ReturnType<typeof acquisitionInputSchema.parse>;

export function acquisitionRef(
  a: Pick<AcqRow, "organizationId" | "captadorUserId" | "branchId" | "teamId">,
): ResourceRef {
  return {
    organizationId: a.organizationId,
    ownerUserId: a.captadorUserId,
    branchId: a.branchId,
    teamId: a.teamId,
  };
}

function acquisitionValues(input: AcqInput) {
  const minor = (v: string | null) => (v ? parseMoney(v, input.currency).amountMinor : null);
  return {
    ownerContactId: input.ownerContactId,
    propertyType: input.propertyType,
    operation: input.operation,
    address: input.address,
    padron: input.padron,
    latitude: input.latitude,
    longitude: input.longitude,
    sourcePortal: input.sourcePortal,
    portalUrl: input.portalUrl,
    localityId: input.localityId,
    neighborhoodId: input.neighborhoodId,
    exclusive: input.exclusive,
    exclusiveFrom: input.exclusive ? input.exclusiveFrom : null,
    exclusiveUntil: input.exclusive ? input.exclusiveUntil : null,
    commissionBasisPoints: input.commissionPercent
      ? parsePercentToBasisPoints(input.commissionPercent)
      : null,
    currency: input.currency,
    askingMinor: minor(input.askingPrice),
    recommendedMinor: minor(input.recommendedPrice),
    publicationAuthorized: input.publicationAuthorized,
    notes: input.notes,
  };
}

async function assertOwnerVisible(tx: DbOrTx, ctx: RequestContext, contactId: string) {
  const [c] = await tx
    .select()
    .from(contact)
    .where(
      and(
        eq(contact.id, contactId),
        eq(contact.organizationId, ctx.organizationId),
        isNull(contact.deletedAt),
      ),
    );
  if (!c) throw new ValidationError("Propietario inválido", { ownerContactId: ["Contacto inválido"] });
  if (
    !hasPermission(ctx, "owner.read", contactRef(c)) &&
    !hasPermission(ctx, "contact.read", contactRef(c))
  ) {
    throw new ForbiddenError("No podés usar un contacto que no podés ver");
  }
  return c;
}

async function assertPropertyVisible(tx: DbOrTx, ctx: RequestContext, propertyId: string | null) {
  if (!propertyId) return null;
  const [p] = await tx
    .select()
    .from(property)
    .where(
      and(
        eq(property.id, propertyId),
        eq(property.organizationId, ctx.organizationId),
        isNull(property.deletedAt),
      ),
    );
  if (!p || !hasPermission(ctx, "property.read", propertyRef(p))) {
    throw new ValidationError("Propiedad inválida", { propertyId: ["Propiedad inválida"] });
  }
  return p;
}

async function resolveCaptador(tx: DbOrTx, ctx: RequestContext, requested: string | null) {
  const captadorUserId = requested ?? ctx.userId;
  if (captadorUserId !== ctx.userId) {
    const scope = widestScope(ctx.grants, "acquisition.manage");
    if (!scope || SCOPE_RANK[scope] <= SCOPE_RANK.own)
      throw new ForbiddenError("No podés asignar captaciones a otros agentes");
  }
  return { captadorUserId, ...(await resolveAssignment(tx, ctx.organizationId, captadorUserId)) };
}

export async function createAcquisition(db: Db, ctx: RequestContext, rawInput: unknown) {
  requirePermission(ctx, "acquisition.manage");
  const input = parseInput(acquisitionInputSchema, rawInput);
  return db.transaction(async (tx) => {
    const owner = await assertOwnerVisible(tx, ctx, input.ownerContactId);
    await assertPropertyVisible(tx, ctx, input.propertyId);
    const captador = await resolveCaptador(tx, ctx, input.captadorUserId);
    const code = await nextCode(tx, ctx.organizationId, "CAP");
    const [row] = await tx
      .insert(acquisition)
      .values({
        organizationId: ctx.organizationId,
        code,
        ...acquisitionValues(input),
        propertyId: input.propertyId,
        ...captador,
        createdById: ctx.userId,
      })
      .returning();
    if (!row) throw new Error("No se pudo crear la captación");
    await tx
      .insert(ownerProfile)
      .values({ contactId: owner.id, organizationId: ctx.organizationId })
      .onConflictDoNothing();
    await logActivity(tx, ctx, {
      type: "owner_updated",
      contactId: owner.id,
      body: `Nueva captación ${code}`,
      payload: { acquisitionId: row.id },
    });
    await writeAudit(tx, ctx, {
      action: "acquisition.create",
      entityType: "acquisition",
      entityId: row.id,
      after: row,
    });
    await emitEvent(tx, ctx, {
      type: "acquisition.created",
      aggregateType: "acquisition",
      aggregateId: row.id,
    });
    return row;
  });
}

async function loadForWrite(tx: DbOrTx, ctx: RequestContext, id: string) {
  const [row] = await tx
    .select()
    .from(acquisition)
    .where(
      and(
        eq(acquisition.id, id),
        eq(acquisition.organizationId, ctx.organizationId),
        isNull(acquisition.deletedAt),
      ),
    )
    .for("update");
  if (!row) throw new NotFoundError("Captación");
  return row;
}

export async function updateAcquisition(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(updateAcquisitionSchema, rawInput);
  return db.transaction(async (tx) => {
    const before = await loadForWrite(tx, ctx, input.id);
    requirePermission(ctx, "acquisition.manage", acquisitionRef(before));
    await assertOwnerVisible(tx, ctx, input.ownerContactId);
    await assertPropertyVisible(tx, ctx, input.propertyId);
    const captador =
      input.captadorUserId && input.captadorUserId !== before.captadorUserId
        ? await resolveCaptador(tx, ctx, input.captadorUserId)
        : { captadorUserId: before.captadorUserId, branchId: before.branchId, teamId: before.teamId };
    const [after] = await tx
      .update(acquisition)
      .set({ ...acquisitionValues(input), propertyId: input.propertyId ?? before.propertyId, ...captador })
      .where(eq(acquisition.id, before.id))
      .returning();
    await writeAudit(tx, ctx, {
      action: "acquisition.update",
      entityType: "acquisition",
      entityId: before.id,
      before,
      after,
    });
    return after;
  });
}

/**
 * Cambio de etapa. Al pasar a "Captado" (requiere autorización de publicación firmada) se crea
 * la propiedad en borrador si no existía, con el propietario al 100 %, la comisión acordada y
 * los precios pedido/recomendado. Todo en una transacción.
 */
export async function changeAcquisitionStage(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(acquisitionStageSchema, rawInput);
  return db.transaction(async (tx) => {
    const before = await loadForWrite(tx, ctx, input.id);
    requirePermission(ctx, "acquisition.manage", acquisitionRef(before));
    if (!canTransitionAcquisition(before.stage, input.stage)) {
      throw new ConflictError(
        `No se puede pasar de ${ACQUISITION_STAGE_LABELS[before.stage]} a ${ACQUISITION_STAGE_LABELS[input.stage]}`,
      );
    }
    let propertyId = before.propertyId;
    if (input.stage === "captured") {
      if (!before.publicationAuthorized) {
        throw new ValidationError("Para captar hace falta la autorización de publicación del propietario", {
          publicationAuthorized: ["Falta la autorización"],
        });
      }
      if (!propertyId) {
        const created = await insertProperty(
          tx,
          ctx,
          {
            type: before.propertyType,
            operations: [before.operation],
            title: null,
            description: null,
            departmentId: null,
            localityId: before.localityId,
            neighborhoodId: before.neighborhoodId,
            address: before.address,
            unit: null,
            padron: before.padron,
            latitude: before.latitude,
            longitude: before.longitude,
            bedrooms: null,
            bathrooms: null,
            suites: null,
            garages: null,
            totalArea: null,
            builtArea: null,
            floor: null,
            yearBuilt: null,
            orientation: null,
            condition: null,
            features: [],
            petsAllowed: false,
            furnished: false,
            commissionPercent: null,
            assignedUserId: before.captadorUserId,
            internalNotes: `Creada desde la captación ${before.code}`,
            expenses: [],
          },
          { captadorUserId: before.captadorUserId ?? ctx.userId },
        );
        propertyId = created.id;
        await tx
          .update(property)
          .set({
            commissionBasisPoints: before.commissionBasisPoints,
            exclusive: before.exclusive,
            exclusiveUntil: before.exclusive ? before.exclusiveUntil : null,
          })
          .where(eq(property.id, created.id));
        await tx.insert(propertyOwner).values({
          propertyId,
          contactId: before.ownerContactId,
          organizationId: ctx.organizationId,
          shareBasisPoints: 10_000,
        });
        if (before.askingMinor !== null || before.recommendedMinor !== null) {
          await tx.insert(propertyPrice).values({
            propertyId,
            operation: before.operation,
            currency: before.currency,
            listMinor: before.recommendedMinor ?? before.askingMinor,
            ownerAskingMinor: before.askingMinor,
          });
        }
        await syncPropertySearch(tx, [propertyId]);
      }
    }
    const now = new Date();
    const [after] = await tx
      .update(acquisition)
      .set({
        stage: input.stage,
        stageChangedAt: now,
        propertyId,
        lostReason: input.stage === "lost" ? input.lostReason : null,
        ...(input.stage === "captured" ? { capturedAt: now } : {}),
      })
      .where(eq(acquisition.id, before.id))
      .returning();
    await logActivity(tx, ctx, {
      type: "owner_updated",
      contactId: before.ownerContactId,
      body: `Captación ${before.code}: ${ACQUISITION_STAGE_LABELS[before.stage]} → ${ACQUISITION_STAGE_LABELS[input.stage]}`,
      payload: { acquisitionId: before.id, propertyId },
    });
    await writeAudit(tx, ctx, {
      action: "acquisition.stage_change",
      entityType: "acquisition",
      entityId: before.id,
      before: { stage: before.stage },
      after: { stage: input.stage, propertyId, lostReason: input.lostReason },
    });
    await emitEvent(tx, ctx, {
      type: "acquisition.stage_changed",
      aggregateType: "acquisition",
      aggregateId: before.id,
      payload: { from: before.stage, to: input.stage, propertyId },
    });
    return after;
  });
}

export async function listAcquisitions(db: DbOrTx, ctx: RequestContext, rawQuery: unknown) {
  requirePermission(ctx, "acquisition.read");
  const q = parseInput(acquisitionListSchema, rawQuery);
  const conditions: (SQL | undefined)[] = [
    eq(acquisition.organizationId, ctx.organizationId),
    isNull(acquisition.deletedAt),
    scopeCondition(ctx, "acquisition.read", {
      ownerUserId: acquisition.captadorUserId,
      branchId: acquisition.branchId,
      teamId: acquisition.teamId,
    }),
  ];
  if (q.stage === "open") conditions.push(inArray(acquisition.stage, [...OPEN_ACQUISITION_STAGES]));
  else if (q.stage) conditions.push(eq(acquisition.stage, q.stage));
  if (q.q) {
    const term = `%${normalizeText(q.q)}%`;
    conditions.push(
      sql`(lower(${acquisition.code}) like ${term} or lower(unaccent(coalesce(${acquisition.address}, ''))) like ${term} or lower(unaccent(${contact.displayName})) like ${term})`,
    );
  }
  const where = and(...conditions);
  const [rows, totals, byStage] = await Promise.all([
    db
      .select({
        a: acquisition,
        ownerName: contact.displayName,
        ownerAssigned: contact.assignedUserId,
        ownerBranch: contact.branchId,
        ownerTeam: contact.teamId,
        captadorName: user.name,
        localityName: locality.name,
        neighborhoodName: neighborhood.name,
      })
      .from(acquisition)
      .innerJoin(contact, eq(contact.id, acquisition.ownerContactId))
      .leftJoin(user, eq(user.id, acquisition.captadorUserId))
      .leftJoin(locality, eq(locality.id, acquisition.localityId))
      .leftJoin(neighborhood, eq(neighborhood.id, acquisition.neighborhoodId))
      .where(where)
      .orderBy(desc(acquisition.updatedAt))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db
      .select({ total: count() })
      .from(acquisition)
      .innerJoin(contact, eq(contact.id, acquisition.ownerContactId))
      .where(where),
    db
      .select({ stage: acquisition.stage, n: count() })
      .from(acquisition)
      .where(
        and(eq(acquisition.organizationId, ctx.organizationId), isNull(acquisition.deletedAt), conditions[2]),
      )
      .groupBy(acquisition.stage),
  ]);
  return {
    items: rows.map((r) => {
      const ownerVisible =
        hasPermission(ctx, "owner.read", {
          organizationId: ctx.organizationId,
          ownerUserId: r.ownerAssigned,
          branchId: r.ownerBranch,
          teamId: r.ownerTeam,
        }) ||
        hasPermission(ctx, "contact.read", {
          organizationId: ctx.organizationId,
          ownerUserId: r.ownerAssigned,
          branchId: r.ownerBranch,
          teamId: r.ownerTeam,
        });
      return {
        ...r.a,
        ownerName: ownerVisible ? r.ownerName : "Propietario (restringido)",
        captadorName: r.captadorName,
        zone: [r.neighborhoodName, r.localityName].filter(Boolean).join(", "),
      };
    }),
    total: totals[0]?.total ?? 0,
    page: q.page,
    pageSize: q.pageSize,
    byStage: Object.fromEntries(byStage.map((s) => [s.stage, s.n])) as Partial<
      Record<AcqRow["stage"], number>
    >,
  };
}

export async function getAcquisition(db: DbOrTx, ctx: RequestContext, acquisitionId: string) {
  const id = parseInput(uuidSchema, acquisitionId);
  const [row] = await db
    .select({
      a: acquisition,
      owner: contact,
      captadorName: user.name,
      localityName: locality.name,
      neighborhoodName: neighborhood.name,
    })
    .from(acquisition)
    .innerJoin(contact, eq(contact.id, acquisition.ownerContactId))
    .leftJoin(user, eq(user.id, acquisition.captadorUserId))
    .leftJoin(locality, eq(locality.id, acquisition.localityId))
    .leftJoin(neighborhood, eq(neighborhood.id, acquisition.neighborhoodId))
    .where(
      and(
        eq(acquisition.id, id),
        eq(acquisition.organizationId, ctx.organizationId),
        isNull(acquisition.deletedAt),
      ),
    );
  if (!row) throw new NotFoundError("Captación");
  const ref = acquisitionRef(row.a);
  if (!hasPermission(ctx, "acquisition.read", ref)) throw new NotFoundError("Captación");
  const ownerVisible =
    hasPermission(ctx, "owner.read", contactRef(row.owner)) ||
    hasPermission(ctx, "contact.read", contactRef(row.owner));
  const [prop] = row.a.propertyId
    ? await db.select().from(property).where(eq(property.id, row.a.propertyId))
    : [];
  const valuations = await listValuationsFor(db, ctx, { acquisitionId: id, propertyId: row.a.propertyId });
  return {
    acquisition: row.a,
    owner: {
      id: ownerVisible ? row.owner.id : null,
      displayName: ownerVisible ? row.owner.displayName : "Propietario (restringido)",
    },
    captadorName: row.captadorName,
    zone: [row.neighborhoodName, row.localityName].filter(Boolean).join(", "),
    property:
      prop && hasPermission(ctx, "property.read", propertyRef(prop))
        ? { id: prop.id, code: prop.code, title: propertyDisplayTitle(prop), status: prop.status }
        : null,
    valuations,
    permissions: {
      manage: hasPermission(ctx, "acquisition.manage", ref),
      valuationManage: hasPermission(ctx, "valuation.manage", ref),
      reassign: (() => {
        const s = widestScope(ctx.grants, "acquisition.manage");
        return !!s && SCOPE_RANK[s] > SCOPE_RANK.own;
      })(),
    },
  };
}

/** Exclusividades que vencen en los próximos días (alerta para el captador). */
export async function expiringExclusivities(db: DbOrTx, ctx: RequestContext, days = 30) {
  if (!hasPermission(ctx, "acquisition.read")) return [];
  const until = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  return db
    .select({
      id: acquisition.id,
      code: acquisition.code,
      exclusiveUntil: acquisition.exclusiveUntil,
      stage: acquisition.stage,
    })
    .from(acquisition)
    .where(
      and(
        eq(acquisition.organizationId, ctx.organizationId),
        isNull(acquisition.deletedAt),
        eq(acquisition.exclusive, true),
        lte(acquisition.exclusiveUntil, until),
        sql`${acquisition.exclusiveUntil} >= current_date`,
        scopeCondition(ctx, "acquisition.read", {
          ownerUserId: acquisition.captadorUserId,
          branchId: acquisition.branchId,
          teamId: acquisition.teamId,
        }),
      ),
    )
    .orderBy(asc(acquisition.exclusiveUntil));
}

// ---------------------------------------------------------------------------------------------
// Tasaciones
// ---------------------------------------------------------------------------------------------

async function valuationTargetRef(
  tx: DbOrTx,
  ctx: RequestContext,
  input: { propertyId: string | null; acquisitionId: string | null },
) {
  if (input.acquisitionId) {
    const [a] = await tx
      .select()
      .from(acquisition)
      .where(
        and(eq(acquisition.id, input.acquisitionId), eq(acquisition.organizationId, ctx.organizationId)),
      );
    if (!a) throw new NotFoundError("Captación");
    return {
      ref: acquisitionRef(a),
      propertyId: input.propertyId ?? a.propertyId,
      branchId: a.branchId,
      teamId: a.teamId,
    };
  }
  const [p] = await tx
    .select()
    .from(property)
    .where(and(eq(property.id, input.propertyId ?? ""), eq(property.organizationId, ctx.organizationId)));
  if (!p) throw new NotFoundError("Propiedad");
  return { ref: propertyRef(p), propertyId: p.id, branchId: p.branchId, teamId: p.teamId };
}

export async function createValuation(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(valuationInputSchema, rawInput);
  return db.transaction(async (tx) => {
    const target = await valuationTargetRef(tx, ctx, input);
    requirePermission(ctx, "valuation.manage", target.ref);
    const minor = (v: string | null) => (v ? parseMoney(v, input.currency).amountMinor : null);
    const [row] = await tx
      .insert(valuation)
      .values({
        organizationId: ctx.organizationId,
        propertyId: target.propertyId,
        acquisitionId: input.acquisitionId,
        method: input.method,
        currency: input.currency,
        valueMinor: minor(input.value) ?? 0n,
        minMinor: minor(input.min),
        maxMinor: minor(input.max),
        valuedAt: input.valuedAt ?? new Date().toISOString().slice(0, 10),
        comparables: input.comparables.map((c) => ({
          address: c.address,
          priceMinor: minor(c.price)?.toString() ?? null,
          areaM2: c.areaM2,
          url: c.url,
        })),
        notes: input.notes,
        valuedById: ctx.userId,
        branchId: target.branchId,
        teamId: target.teamId,
      })
      .returning();
    if (!row) throw new Error("No se pudo guardar la tasación");
    await writeAudit(tx, ctx, {
      action: "valuation.create",
      entityType: "valuation",
      entityId: row.id,
      after: row,
    });
    await emitEvent(tx, ctx, { type: "valuation.created", aggregateType: "valuation", aggregateId: row.id });
    return row;
  });
}

export async function listValuationsFor(
  db: DbOrTx,
  ctx: RequestContext,
  target: { propertyId?: string | null; acquisitionId?: string | null },
) {
  const conds: SQL[] = [];
  if (target.propertyId) conds.push(eq(valuation.propertyId, target.propertyId));
  if (target.acquisitionId) conds.push(eq(valuation.acquisitionId, target.acquisitionId));
  if (conds.length === 0) return [];
  const rows = await db
    .select({ v: valuation, valuedBy: user.name })
    .from(valuation)
    .leftJoin(user, eq(user.id, valuation.valuedById))
    .where(
      and(
        eq(valuation.organizationId, ctx.organizationId),
        conds.length === 1 ? conds[0] : sql`(${conds[0]} or ${conds[1]})`,
      ),
    )
    .orderBy(desc(valuation.valuedAt), desc(valuation.createdAt));
  const refFor = (v: typeof valuation.$inferSelect): ResourceRef => ({
    organizationId: v.organizationId,
    ownerUserId: v.valuedById,
    branchId: v.branchId,
    teamId: v.teamId,
  });
  return rows
    .filter((r) => hasPermission(ctx, "valuation.read", refFor(r.v)) || hasPermission(ctx, "property.read"))
    .map((r) => ({ ...r.v, valuedBy: r.valuedBy }));
}

export async function listValuations(db: DbOrTx, ctx: RequestContext, rawQuery: unknown) {
  requirePermission(ctx, "valuation.read");
  const q = parseInput(listQuerySchema, rawQuery);
  const where = and(
    eq(valuation.organizationId, ctx.organizationId),
    scopeCondition(ctx, "valuation.read", {
      ownerUserId: valuation.valuedById,
      branchId: valuation.branchId,
      teamId: valuation.teamId,
    }),
  );
  const [rows, totals] = await Promise.all([
    db
      .select({
        v: valuation,
        valuedBy: user.name,
        propertyCode: property.code,
        propertyTitle: property.title,
        propertyType: property.type,
        acquisitionCode: acquisition.code,
      })
      .from(valuation)
      .leftJoin(user, eq(user.id, valuation.valuedById))
      .leftJoin(property, eq(property.id, valuation.propertyId))
      .leftJoin(acquisition, eq(acquisition.id, valuation.acquisitionId))
      .where(where)
      .orderBy(desc(valuation.valuedAt), desc(valuation.createdAt))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ total: count() }).from(valuation).where(where),
  ]);
  return {
    items: rows.map((r) => ({
      ...r.v,
      valuedBy: r.valuedBy,
      propertyCode: r.propertyCode,
      propertyTitle: r.propertyTitle,
      propertyType: r.propertyType,
      acquisitionCode: r.acquisitionCode,
    })),
    total: totals[0]?.total ?? 0,
    page: q.page,
    pageSize: q.pageSize,
  };
}
