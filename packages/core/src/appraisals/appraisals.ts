import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import {
  appraisal,
  commissionSettings,
  deal,
  department,
  locality,
  neighborhood,
  property,
  propertyPrice,
  user,
  type Db,
  type DbOrTx,
} from "@crm/db";
import {
  appraisalArea,
  computeAppraisal,
  type AppraisalComparable,
  type AppraisalResult,
} from "@crm/shared/appraisal";
import { PROPERTY_TYPE_LABELS, type PropertyType } from "@crm/shared/crm";
import {
  appraisalInputSchema,
  appraisalListSchema,
  comparatorQuerySchema,
} from "@crm/shared/validation/appraisal";
import { uuidSchema } from "@crm/shared/validation";
import type { ResourceRef } from "@crm/shared/rbac";
import { scopeCondition } from "../access-filter";
import { writeAudit } from "../audit";
import { hasPermission, requirePermission, type RequestContext } from "../context";
import { resolveAssignment } from "../crm/helpers";
import { ForbiddenError, NotFoundError, parseInput } from "../errors";
import { emitEvent } from "../events";
import { nextCode } from "../sequences";

type AppraisalRow = typeof appraisal.$inferSelect;

const toMinor = (v: number | null | undefined) =>
  v === null || v === undefined ? null : BigInt(Math.round(v * 100));
const fromMinor = (v: bigint | null | undefined) => (v === null || v === undefined ? null : Number(v) / 100);

function appraisalRef(
  a: Pick<AppraisalRow, "organizationId" | "valuedById" | "branchId" | "teamId">,
): ResourceRef {
  return {
    organizationId: a.organizationId,
    ownerUserId: a.valuedById,
    branchId: a.branchId,
    teamId: a.teamId,
  };
}

async function loadAppraisal(db: DbOrTx, ctx: RequestContext, id: string) {
  if (!uuidSchema.safeParse(id).success) throw new NotFoundError("Tasación");
  const [a] = await db
    .select()
    .from(appraisal)
    .where(
      and(
        eq(appraisal.id, id),
        eq(appraisal.organizationId, ctx.organizationId),
        isNull(appraisal.deletedAt),
      ),
    );
  if (!a) throw new NotFoundError("Tasación");
  return a;
}

/** Crea o actualiza una tasación; el resultado se recalcula siempre en el servidor. */
export async function saveAppraisal(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(appraisalInputSchema, rawInput);
  const comparables: AppraisalComparable[] = input.comparables
    .filter((c) => c.reference || c.m2 || c.price)
    .map((c) => ({
      reference: c.reference,
      m2: c.m2,
      construction: c.construction,
      location: c.location,
      kind: c.kind,
      price: c.price,
      url: c.url,
      sourceCode: c.sourceCode,
    }));
  const result = computeAppraisal({
    area: appraisalArea(input.builtArea, input.totalArea),
    comparables,
    offerDiscountBp: input.offerDiscountBp,
    currency: input.currency,
  });
  const values = {
    status: input.status,
    title: input.title,
    address: input.address,
    propertyType: input.propertyType,
    operation: input.operation,
    departmentId: input.departmentId ?? null,
    localityId: input.localityId ?? null,
    neighborhoodId: input.neighborhoodId ?? null,
    builtArea: input.builtArea?.toString() ?? null,
    totalArea: input.totalArea?.toString() ?? null,
    bedrooms: input.bedrooms,
    bathrooms: input.bathrooms,
    garages: input.garages,
    yearBuilt: input.yearBuilt,
    condition: input.condition ?? null,
    clientName: input.clientName,
    clientContactId: input.clientContactId ?? null,
    currency: input.currency,
    offerDiscountBp: input.offerDiscountBp,
    comparables,
    unitValueMinor: toMinor(result.unitAverage),
    estimatedMinor: toMinor(result.value),
    minMinor: toMinor(result.min),
    maxMinor: toMinor(result.max),
    adoptedMinor: toMinor(input.adoptedValue),
    notes: input.notes,
  };

  return db.transaction(async (tx) => {
    if (input.id) {
      const before = await loadAppraisal(tx, ctx, input.id);
      requirePermission(ctx, "valuation.manage", appraisalRef(before));
      const [after] = await tx
        .update(appraisal)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(appraisal.id, before.id))
        .returning();
      if (!after) throw new Error("No se pudo guardar la tasación");
      await writeAudit(tx, ctx, {
        action: "appraisal.update",
        entityType: "appraisal",
        entityId: after.id,
        before,
        after,
      });
      return after;
    }
    requirePermission(ctx, "valuation.manage");
    const assignment = await resolveAssignment(tx, ctx.organizationId, ctx.userId);
    const [row] = await tx
      .insert(appraisal)
      .values({
        ...values,
        organizationId: ctx.organizationId,
        code: await nextCode(tx, ctx.organizationId, "TAS"),
        valuedAt: new Date().toISOString().slice(0, 10),
        valuedById: ctx.userId,
        branchId: assignment.branchId,
        teamId: assignment.teamId,
      })
      .returning();
    if (!row) throw new Error("No se pudo guardar la tasación");
    await writeAudit(tx, ctx, {
      action: "appraisal.create",
      entityType: "appraisal",
      entityId: row.id,
      after: row,
    });
    await emitEvent(tx, ctx, { type: "appraisal.created", aggregateType: "appraisal", aggregateId: row.id });
    return row;
  });
}

export interface AppraisalView extends Omit<AppraisalRow, "builtArea" | "totalArea"> {
  builtArea: number | null;
  totalArea: number | null;
  zone: string;
  departmentName: string | null;
  localityName: string | null;
  neighborhoodName: string | null;
  valuedByName: string | null;
  typeLabel: string;
  result: AppraisalResult;
  finalValue: number | null;
}

export async function getAppraisal(db: DbOrTx, ctx: RequestContext, id: string): Promise<AppraisalView> {
  const a = await loadAppraisal(db, ctx, id);
  requirePermission(ctx, "valuation.read", appraisalRef(a));
  const [names] = await db
    .select({ d: department.name, l: locality.name, n: neighborhood.name, by: user.name })
    .from(appraisal)
    .leftJoin(department, eq(department.id, appraisal.departmentId))
    .leftJoin(locality, eq(locality.id, appraisal.localityId))
    .leftJoin(neighborhood, eq(neighborhood.id, appraisal.neighborhoodId))
    .leftJoin(user, eq(user.id, appraisal.valuedById))
    .where(eq(appraisal.id, a.id));
  const builtArea = a.builtArea ? Number(a.builtArea) : null;
  const totalArea = a.totalArea ? Number(a.totalArea) : null;
  const result = computeAppraisal({
    area: appraisalArea(builtArea, totalArea),
    comparables: a.comparables,
    offerDiscountBp: a.offerDiscountBp,
    currency: a.currency,
  });
  return {
    ...a,
    builtArea,
    totalArea,
    departmentName: names?.d ?? null,
    localityName: names?.l ?? null,
    neighborhoodName: names?.n ?? null,
    zone: [names?.n, names?.l, names?.d].filter(Boolean).join(", "),
    valuedByName: names?.by ?? null,
    typeLabel: PROPERTY_TYPE_LABELS[a.propertyType as PropertyType],
    result,
    finalValue: fromMinor(a.adoptedMinor) ?? result.value,
  };
}

export async function listAppraisals(db: DbOrTx, ctx: RequestContext, rawQuery: unknown) {
  requirePermission(ctx, "valuation.read");
  const q = parseInput(appraisalListSchema, rawQuery);
  const conds: SQL[] = [
    eq(appraisal.organizationId, ctx.organizationId),
    isNull(appraisal.deletedAt),
    scopeCondition(ctx, "valuation.read", {
      ownerUserId: appraisal.valuedById,
      branchId: appraisal.branchId,
      teamId: appraisal.teamId,
    }),
  ];
  if (q.status) conds.push(eq(appraisal.status, q.status));
  if (q.q) {
    const like = `%${q.q.replace(/[%_]/g, "")}%`;
    const term = or(
      ilike(appraisal.code, like),
      ilike(appraisal.title, like),
      ilike(appraisal.address, like),
      ilike(appraisal.clientName, like),
      ilike(neighborhood.name, like),
      ilike(locality.name, like),
    );
    if (term) conds.push(term);
  }
  const where = and(...conds);
  const [rows, totals] = await Promise.all([
    db
      .select({ a: appraisal, l: locality.name, n: neighborhood.name, by: user.name })
      .from(appraisal)
      .leftJoin(locality, eq(locality.id, appraisal.localityId))
      .leftJoin(neighborhood, eq(neighborhood.id, appraisal.neighborhoodId))
      .leftJoin(user, eq(user.id, appraisal.valuedById))
      .where(where)
      .orderBy(desc(appraisal.valuedAt), desc(appraisal.createdAt))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db
      .select({ total: count() })
      .from(appraisal)
      .leftJoin(locality, eq(locality.id, appraisal.localityId))
      .leftJoin(neighborhood, eq(neighborhood.id, appraisal.neighborhoodId))
      .where(where),
  ]);
  return {
    items: rows.map((r) => ({
      id: r.a.id,
      code: r.a.code,
      status: r.a.status as "draft" | "final",
      title: r.a.title,
      address: r.a.address,
      typeLabel: PROPERTY_TYPE_LABELS[r.a.propertyType as PropertyType],
      operation: r.a.operation,
      zone: [r.n, r.l].filter(Boolean).join(", "),
      area: appraisalArea(
        r.a.builtArea ? Number(r.a.builtArea) : null,
        r.a.totalArea ? Number(r.a.totalArea) : null,
      ),
      currency: r.a.currency,
      unitValue: fromMinor(r.a.unitValueMinor),
      value: fromMinor(r.a.adoptedMinor) ?? fromMinor(r.a.estimatedMinor),
      comparables: r.a.comparables.length,
      clientName: r.a.clientName,
      valuedAt: r.a.valuedAt,
      valuedByName: r.by,
      canEdit: hasPermission(ctx, "valuation.manage", appraisalRef(r.a)),
    })),
    total: totals[0]?.total ?? 0,
    page: q.page,
    pageSize: q.pageSize,
  };
}

export async function deleteAppraisal(db: Db, ctx: RequestContext, id: string) {
  return db.transaction(async (tx) => {
    const a = await loadAppraisal(tx, ctx, id);
    if (!hasPermission(ctx, "valuation.manage", appraisalRef(a))) throw new ForbiddenError();
    await tx.update(appraisal).set({ deletedAt: new Date() }).where(eq(appraisal.id, a.id));
    await writeAudit(tx, ctx, {
      action: "appraisal.delete",
      entityType: "appraisal",
      entityId: a.id,
      before: a,
    });
  });
}

// ─── Comparador de mercado ─────────────────────────────────────────────────

export interface ComparatorRow {
  kind: "real" | "offer";
  propertyId: string;
  code: string;
  title: string;
  typeLabel: string;
  zone: string;
  area: number;
  bedrooms: number | null;
  price: number;
  originalCurrency: "USD" | "UYU";
  unit: number;
  date: string | null;
}

function stats(units: number[]) {
  if (!units.length) return null;
  const s = [...units].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return {
    count: s.length,
    average: s.reduce((x, y) => x + y, 0) / s.length,
    median: s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2,
    min: s[0] as number,
    max: s[s.length - 1] as number,
  };
}

/**
 * Valores por m² del mercado con datos del propio CRM: precios publicados (ofertas) y
 * operaciones cerradas (valores reales), filtrados por zona, tipo y superficie.
 */
export async function marketComparator(db: DbOrTx, ctx: RequestContext, rawQuery: unknown) {
  requirePermission(ctx, "property.read");
  const q = parseInput(comparatorQuerySchema, rawQuery);
  const [settings] = await db
    .select({ rate: commissionSettings.uyuPerUsd })
    .from(commissionSettings)
    .where(eq(commissionSettings.organizationId, ctx.organizationId));
  const rate = settings?.rate ? Number(settings.rate) : 40;
  const convert = (amount: number, from: "USD" | "UYU") =>
    from === q.currency ? amount : q.currency === "USD" ? amount / rate : amount * rate;

  const conds: SQL[] = [
    eq(property.organizationId, ctx.organizationId),
    isNull(property.deletedAt),
    scopeCondition(ctx, "property.read", {
      ownerUserId: property.assignedUserId,
      branchId: property.branchId,
      teamId: property.teamId,
    }),
  ];
  if (q.propertyType) conds.push(eq(property.type, q.propertyType));
  if (q.neighborhoodId) conds.push(eq(property.neighborhoodId, q.neighborhoodId));
  else if (q.localityId) conds.push(eq(property.localityId, q.localityId));
  else if (q.departmentId) conds.push(eq(property.departmentId, q.departmentId));
  if (q.bedrooms !== undefined) conds.push(sql`coalesce(${property.bedrooms}, 0) >= ${q.bedrooms}`);
  const areaExpr = sql<string>`coalesce(nullif(${property.builtArea}, 0), ${property.totalArea})`;
  conds.push(sql`${areaExpr} > 0`);
  if (q.minArea) conds.push(sql`${areaExpr} >= ${q.minArea}`);
  if (q.maxArea) conds.push(sql`${areaExpr} <= ${q.maxArea}`);

  const base = {
    id: property.id,
    code: property.code,
    title: property.title,
    type: property.type,
    area: areaExpr,
    bedrooms: property.bedrooms,
    l: locality.name,
    n: neighborhood.name,
  };
  const [offers, reals] = await Promise.all([
    db
      .select({
        ...base,
        currency: propertyPrice.currency,
        amount: propertyPrice.listMinor,
        date: property.publishedAt,
      })
      .from(property)
      .innerJoin(
        propertyPrice,
        and(eq(propertyPrice.propertyId, property.id), eq(propertyPrice.operation, q.operation)),
      )
      .leftJoin(locality, eq(locality.id, property.localityId))
      .leftJoin(neighborhood, eq(neighborhood.id, property.neighborhoodId))
      .where(
        and(
          ...conds,
          inArray(property.status, ["available", "published", "negotiating", "reserved"]),
          sql`${propertyPrice.listMinor} > 0`,
        ),
      )
      .orderBy(asc(property.code))
      .limit(200),
    db
      .select({ ...base, currency: deal.currency, amount: deal.priceMinor, date: deal.closedAt })
      .from(deal)
      .innerJoin(property, eq(property.id, deal.propertyId))
      .leftJoin(locality, eq(locality.id, property.localityId))
      .leftJoin(neighborhood, eq(neighborhood.id, property.neighborhoodId))
      .where(
        and(
          ...conds,
          eq(deal.organizationId, ctx.organizationId),
          eq(deal.stage, "closed"),
          eq(deal.operation, q.operation),
        ),
      )
      .orderBy(desc(deal.closedAt))
      .limit(200),
  ]);

  type Raw = Omit<(typeof offers)[number], "date" | "amount"> & {
    date: Date | string | null;
    amount: bigint | null;
  };
  const toRow =
    (kind: "real" | "offer") =>
    (r: Raw): ComparatorRow => {
      const area = Number(r.area);
      const price = convert(Number(r.amount ?? 0n) / 100, r.currency);
      return {
        kind,
        propertyId: r.id,
        code: r.code,
        title: r.title?.trim() || `${PROPERTY_TYPE_LABELS[r.type as PropertyType]} ${r.code}`,
        typeLabel: PROPERTY_TYPE_LABELS[r.type as PropertyType],
        zone: [r.n, r.l].filter(Boolean).join(", "),
        area,
        bedrooms: r.bedrooms,
        price,
        originalCurrency: r.currency,
        unit: price / area,
        date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : (r.date ?? null),
      };
    };
  const rows = [...reals.map(toRow("real")), ...offers.map(toRow("offer"))];
  return {
    query: q,
    rate,
    rows,
    stats: {
      all: stats(rows.map((r) => r.unit)),
      real: stats(rows.filter((r) => r.kind === "real").map((r) => r.unit)),
      offer: stats(rows.filter((r) => r.kind === "offer").map((r) => r.unit)),
    },
  };
}

/** Comparables listos para una tasación a partir de filas del comparador. */
export async function comparablesFromProperties(
  db: DbOrTx,
  ctx: RequestContext,
  codes: string[],
  query: unknown,
): Promise<AppraisalComparable[]> {
  const wanted = codes.filter((c) => /^[A-Z]{2,6}-\d{1,9}$/.test(c)).slice(0, 20);
  if (!wanted.length) return [];
  const market = await marketComparator(db, ctx, query);
  return market.rows
    .filter((r) => wanted.includes(r.code))
    .map((r) => ({
      reference: `${r.code} · ${r.title}${r.zone ? ` (${r.zone})` : ""}`.slice(0, 200),
      m2: r.area,
      construction: 0,
      location: 0,
      kind: r.kind,
      price: Math.round(r.price),
      url: null,
      sourceCode: r.code,
    }));
}
