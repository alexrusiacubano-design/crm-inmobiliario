import { and, asc, count, desc, eq, gte, inArray, isNull, ne, notInArray, sql, type SQL } from "drizzle-orm";
import {
  commissionSettings,
  contact,
  contactChannel,
  deal,
  lead,
  locality,
  neighborhood,
  property,
  propertyExpense,
  propertyMatch,
  propertyMedia,
  propertyPrice,
  searchProfile,
  user,
  type Db,
  type DbOrTx,
} from "@crm/db";
import {
  comparableConfidence,
  convertMinor,
  LEAD_TO_PROPERTY_OPERATION,
  MATCHABLE_PROPERTY_STATUSES,
  medianPricePerM2,
  monthlyExpenseMinor,
  OPEN_LEAD_STATUSES,
  parseRate,
  scoreMatch,
  type Currency,
  type LeadOperation,
  type MatchProfile,
  type MatchProperty,
  type MatchStatus,
  type PropertyOperation,
} from "@crm/shared";
import { comparablesQuerySchema, setMatchStatusSchema } from "@crm/shared/validation/matching";
import { uuidSchema } from "@crm/shared/validation";
import { scopeCondition } from "../access-filter";
import { writeAudit } from "../audit";
import { hasPermission, requirePermission, type RequestContext } from "../context";
import { NotFoundError, parseInput } from "../errors";
import { leadRef, logActivity } from "../crm/helpers";
import { propertyDisplayTitle, propertyRef } from "../properties/helpers";

type InventoryItem = MatchProperty & { id: string };
type ProfileRow = typeof searchProfile.$inferSelect;

const STATUS_ORDER: Record<MatchStatus, number> = { interested: 0, suggested: 1, sent: 2, discarded: 3 };

async function orgRate(db: DbOrTx, organizationId: string): Promise<bigint> {
  const [s] = await db
    .select({ uyuPerUsd: commissionSettings.uyuPerUsd })
    .from(commissionSettings)
    .where(eq(commissionSettings.organizationId, organizationId));
  try {
    return parseRate(s?.uyuPerUsd ?? "40");
  } catch {
    return parseRate("40");
  }
}

function toProfile(s: ProfileRow): MatchProfile {
  return {
    operation: s.operation,
    propertyTypes: s.propertyTypes,
    departmentIds: s.departmentIds,
    localityIds: s.localityIds,
    neighborhoodIds: s.neighborhoodIds,
    currency: s.currency,
    priceMinMinor: s.priceMinMinor,
    priceMaxMinor: s.priceMaxMinor,
    bedroomsMin: s.bedroomsMin,
    bathroomsMin: s.bathroomsMin,
    garagesMin: s.garagesMin,
    areaMin: s.areaMin,
    commonExpensesMaxMinor: s.commonExpensesMaxMinor,
    commonExpensesCurrency: s.commonExpensesCurrency,
    pets: s.pets,
    furnished: s.furnished,
    features: s.features,
  };
}

/** Inventario ofrecible para una operación (todas las sucursales: el matching es de la inmobiliaria). */
async function loadInventory(
  db: DbOrTx,
  organizationId: string,
  operation: PropertyOperation,
  propertyIds?: readonly string[],
): Promise<InventoryItem[]> {
  const conditions: (SQL | undefined)[] = [
    eq(property.organizationId, organizationId),
    isNull(property.deletedAt),
    inArray(property.status, [...MATCHABLE_PROPERTY_STATUSES]),
    sql`${operation}::property_operation = any(${property.operations})`,
  ];
  if (propertyIds) conditions.push(inArray(property.id, [...propertyIds]));
  const rows = await db
    .select()
    .from(property)
    .where(and(...conditions));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [prices, expenses] = await Promise.all([
    db
      .select()
      .from(propertyPrice)
      .where(and(inArray(propertyPrice.propertyId, ids), eq(propertyPrice.operation, operation))),
    db
      .select()
      .from(propertyExpense)
      .where(and(inArray(propertyExpense.propertyId, ids), eq(propertyExpense.kind, "common_expenses"))),
  ]);
  return rows.map((r) => {
    const pr = prices.find((p) => p.propertyId === r.id && p.listMinor !== null);
    const ex = expenses.find((e) => e.propertyId === r.id);
    const monthly = ex ? monthlyExpenseMinor(ex.amountMinor, ex.period) : null;
    return {
      id: r.id,
      type: r.type,
      status: r.status,
      operations: r.operations,
      departmentId: r.departmentId,
      localityId: r.localityId,
      neighborhoodId: r.neighborhoodId,
      bedrooms: r.bedrooms,
      bathrooms: r.bathrooms,
      garages: r.garages,
      area: r.builtArea ?? r.totalArea,
      petsAllowed: r.petsAllowed,
      furnished: r.furnished,
      features: r.features,
      price: pr?.listMinor != null ? { currency: pr.currency, amountMinor: pr.listMinor } : null,
      commonExpenses: ex && monthly !== null ? { currency: ex.currency, amountMinor: monthly } : null,
    };
  });
}

/**
 * Recalcula los cruces de los leads dados. Si `onlyPropertyIds` viene, solo toca esas
 * propiedades (uso desde la ficha de propiedad). Las sugerencias que dejan de cumplir se
 * borran; las que ya se trabajaron quedan inactivas.
 */
async function refreshFor(
  db: Db,
  organizationId: string,
  profiles: readonly ProfileRow[],
  onlyPropertyIds?: readonly string[],
): Promise<void> {
  if (!profiles.length) return;
  const rate = await orgRate(db, organizationId);
  const byOp = new Map<LeadOperation, ProfileRow[]>();
  for (const p of profiles) byOp.set(p.operation, [...(byOp.get(p.operation) ?? []), p]);

  const computed: { leadId: string; propertyId: string; score: number; reasons: unknown }[] = [];
  for (const [op, list] of byOp) {
    const inventory = await loadInventory(
      db,
      organizationId,
      LEAD_TO_PROPERTY_OPERATION[op],
      onlyPropertyIds,
    );
    for (const p of list) {
      const profile = toProfile(p);
      for (const item of inventory) {
        const r = scoreMatch(profile, item, rate);
        if (r.eligible)
          computed.push({ leadId: p.leadId, propertyId: item.id, score: r.score, reasons: r.reasons });
      }
    }
  }

  const leadIds = profiles.map((p) => p.leadId);
  await db.transaction(async (tx) => {
    const existing = await tx
      .select({
        id: propertyMatch.id,
        leadId: propertyMatch.leadId,
        propertyId: propertyMatch.propertyId,
        status: propertyMatch.status,
        score: propertyMatch.score,
        active: propertyMatch.active,
        reasons: propertyMatch.reasons,
      })
      .from(propertyMatch)
      .where(
        and(
          inArray(propertyMatch.leadId, leadIds),
          onlyPropertyIds ? inArray(propertyMatch.propertyId, [...onlyPropertyIds]) : undefined,
        ),
      );
    const key = (l: string, p: string) => `${l}:${p}`;
    const current = new Map(existing.map((e) => [key(e.leadId, e.propertyId), e]));
    const seen = new Set<string>();
    const inserts: (typeof propertyMatch.$inferInsert)[] = [];
    for (const c of computed) {
      const k = key(c.leadId, c.propertyId);
      seen.add(k);
      const e = current.get(k);
      const reasons = c.reasons as (typeof propertyMatch.$inferInsert)["reasons"];
      if (!e) {
        inserts.push({ organizationId, leadId: c.leadId, propertyId: c.propertyId, score: c.score, reasons });
      } else if (e.score !== c.score || !e.active || JSON.stringify(e.reasons) !== JSON.stringify(reasons)) {
        await tx
          .update(propertyMatch)
          .set({ score: c.score, reasons, active: true })
          .where(eq(propertyMatch.id, e.id));
      }
    }
    if (inserts.length) await tx.insert(propertyMatch).values(inserts).onConflictDoNothing();
    const gone = existing.filter((e) => !seen.has(key(e.leadId, e.propertyId)));
    const toDelete = gone.filter((e) => e.status === "suggested").map((e) => e.id);
    const toDeactivate = gone.filter((e) => e.status !== "suggested" && e.active).map((e) => e.id);
    if (toDelete.length) await tx.delete(propertyMatch).where(inArray(propertyMatch.id, toDelete));
    if (toDeactivate.length)
      await tx.update(propertyMatch).set({ active: false }).where(inArray(propertyMatch.id, toDeactivate));
  });
}

/** Leads abiertos con búsqueda cargada dentro del alcance del usuario. */
function openLeadsInScope(ctx: RequestContext, extra: (SQL | undefined)[] = []) {
  return and(
    eq(lead.organizationId, ctx.organizationId),
    isNull(lead.deletedAt),
    inArray(lead.status, [...OPEN_LEAD_STATUSES]),
    scopeCondition(ctx, "lead.read", {
      ownerUserId: lead.assignedUserId,
      branchId: lead.branchId,
      teamId: lead.teamId,
    }),
    ...extra,
  );
}

async function loadLeadChecked(db: DbOrTx, ctx: RequestContext, leadId: string) {
  const id = parseInput(uuidSchema, leadId);
  const [l] = await db
    .select()
    .from(lead)
    .where(and(eq(lead.id, id), eq(lead.organizationId, ctx.organizationId), isNull(lead.deletedAt)));
  if (!l || !hasPermission(ctx, "lead.read", leadRef(l))) throw new NotFoundError("Lead");
  return l;
}

/** Propiedades sugeridas para un lead (recalcula antes de responder). */
export async function leadMatches(db: Db, ctx: RequestContext, leadId: string) {
  const l = await loadLeadChecked(db, ctx, leadId);
  const [profile] = await db.select().from(searchProfile).where(eq(searchProfile.leadId, l.id));
  const open = (OPEN_LEAD_STATUSES as readonly string[]).includes(l.status);
  if (profile && open) await refreshFor(db, ctx.organizationId, [profile]);

  const op = LEAD_TO_PROPERTY_OPERATION[l.operation];
  const rows = await db
    .select({
      id: propertyMatch.id,
      status: propertyMatch.status,
      score: propertyMatch.score,
      reasons: propertyMatch.reasons,
      active: propertyMatch.active,
      note: propertyMatch.note,
      sentAt: propertyMatch.sentAt,
      createdAt: propertyMatch.createdAt,
      propertyId: property.id,
      code: property.code,
      title: property.title,
      type: property.type,
      propertyStatus: property.status,
      address: property.address,
      bedrooms: property.bedrooms,
      bathrooms: property.bathrooms,
      builtArea: property.builtArea,
      totalArea: property.totalArea,
      neighborhoodName: neighborhood.name,
      localityName: locality.name,
      agentName: user.name,
    })
    .from(propertyMatch)
    .innerJoin(property, eq(property.id, propertyMatch.propertyId))
    .leftJoin(neighborhood, eq(neighborhood.id, property.neighborhoodId))
    .leftJoin(locality, eq(locality.id, property.localityId))
    .leftJoin(user, eq(user.id, property.assignedUserId))
    .where(and(eq(propertyMatch.leadId, l.id), isNull(property.deletedAt)));

  const ids = rows.map((r) => r.propertyId);
  const [prices, covers] = ids.length
    ? await Promise.all([
        db
          .select()
          .from(propertyPrice)
          .where(and(inArray(propertyPrice.propertyId, ids), eq(propertyPrice.operation, op))),
        db
          .select({ propertyId: propertyMedia.propertyId, id: propertyMedia.id })
          .from(propertyMedia)
          .where(and(inArray(propertyMedia.propertyId, ids), eq(propertyMedia.isCover, true))),
      ])
    : [[], []];

  const items = rows
    .map((r) => {
      const pr = prices.find((p) => p.propertyId === r.propertyId);
      return {
        ...r,
        displayTitle: propertyDisplayTitle(r),
        price: pr?.listMinor != null ? { currency: pr.currency, amountMinor: pr.listMinor } : null,
        coverMediaId: covers.find((c) => c.propertyId === r.propertyId)?.id ?? null,
      };
    })
    .sort(
      (a, b) =>
        Number(b.active) - Number(a.active) ||
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
        b.score - a.score,
    );

  return {
    hasProfile: Boolean(profile),
    open,
    canManage: hasPermission(ctx, "lead.update", leadRef(l)) && hasPermission(ctx, "matching.run"),
    items,
  };
}

/** Clientes a los que les sirve una propiedad (dentro del alcance de leads del usuario). */
export async function propertyMatches(db: Db, ctx: RequestContext, propertyId: string) {
  const id = parseInput(uuidSchema, propertyId);
  const [p] = await db
    .select()
    .from(property)
    .where(
      and(eq(property.id, id), eq(property.organizationId, ctx.organizationId), isNull(property.deletedAt)),
    );
  if (!p || !hasPermission(ctx, "property.read", propertyRef(p))) throw new NotFoundError("Propiedad");
  if (!hasPermission(ctx, "lead.read")) return { items: [], matchable: false };

  const leadOps = (Object.entries(LEAD_TO_PROPERTY_OPERATION) as [LeadOperation, PropertyOperation][])
    .filter(([, po]) => p.operations.includes(po))
    .map(([lo]) => lo);
  const matchable = (MATCHABLE_PROPERTY_STATUSES as readonly string[]).includes(p.status);
  if (leadOps.length && matchable) {
    const profiles = await db
      .select({ sp: searchProfile })
      .from(searchProfile)
      .innerJoin(lead, eq(lead.id, searchProfile.leadId))
      .where(openLeadsInScope(ctx, [inArray(lead.operation, leadOps)]));
    await refreshFor(
      db,
      ctx.organizationId,
      profiles.map((x) => x.sp),
      [p.id],
    );
  }

  const rows = await db
    .select({
      id: propertyMatch.id,
      status: propertyMatch.status,
      score: propertyMatch.score,
      reasons: propertyMatch.reasons,
      active: propertyMatch.active,
      sentAt: propertyMatch.sentAt,
      leadId: lead.id,
      leadCode: lead.code,
      leadStatus: lead.status,
      operation: lead.operation,
      contactId: contact.id,
      contactName: contact.displayName,
      agentName: user.name,
    })
    .from(propertyMatch)
    .innerJoin(lead, eq(lead.id, propertyMatch.leadId))
    .innerJoin(contact, eq(contact.id, lead.contactId))
    .leftJoin(user, eq(user.id, lead.assignedUserId))
    .where(
      and(
        eq(propertyMatch.propertyId, p.id),
        isNull(lead.deletedAt),
        scopeCondition(ctx, "lead.read", {
          ownerUserId: lead.assignedUserId,
          branchId: lead.branchId,
          teamId: lead.teamId,
        }),
      ),
    );
  const contactIds = [...new Set(rows.map((r) => r.contactId))];
  const phones = contactIds.length
    ? await db
        .select({ contactId: contactChannel.contactId, normalized: contactChannel.normalized })
        .from(contactChannel)
        .where(and(inArray(contactChannel.contactId, contactIds), ne(contactChannel.type, "email")))
        .orderBy(desc(contactChannel.isPrimary))
    : [];
  return {
    matchable,
    items: rows
      .map((r) => ({ ...r, phone: phones.find((ph) => ph.contactId === r.contactId)?.normalized ?? null }))
      .sort(
        (a, b) =>
          Number(b.active) - Number(a.active) ||
          STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
          b.score - a.score,
      ),
  };
}

/** Tablero de matching: leads abiertos con búsqueda y cuántas propiedades les sirven. */
export async function matchingOverview(
  db: Db,
  ctx: RequestContext,
  options: { operation?: LeadOperation; mine?: boolean } = {},
) {
  requirePermission(ctx, "lead.read");
  const extra: SQL[] = [];
  if (options.operation) extra.push(eq(lead.operation, options.operation));
  if (options.mine) extra.push(eq(lead.assignedUserId, ctx.userId));
  const where = openLeadsInScope(ctx, extra);

  const profiles = await db
    .select({ sp: searchProfile })
    .from(searchProfile)
    .innerJoin(lead, eq(lead.id, searchProfile.leadId))
    .where(where);
  await refreshFor(
    db,
    ctx.organizationId,
    profiles.map((p) => p.sp),
  );

  const leadsRows = await db
    .select({
      leadId: lead.id,
      code: lead.code,
      status: lead.status,
      operation: lead.operation,
      createdAt: lead.createdAt,
      contactId: contact.id,
      contactName: contact.displayName,
      agentName: user.name,
      hasProfile: sql<boolean>`${searchProfile.leadId} is not null`,
    })
    .from(lead)
    .innerJoin(contact, eq(contact.id, lead.contactId))
    .leftJoin(user, eq(user.id, lead.assignedUserId))
    .leftJoin(searchProfile, eq(searchProfile.leadId, lead.id))
    .where(where)
    .orderBy(desc(lead.createdAt));

  const ids = leadsRows.map((l) => l.leadId);
  const stats = ids.length
    ? await db
        .select({
          leadId: propertyMatch.leadId,
          status: propertyMatch.status,
          n: count(),
          best: sql<number>`max(${propertyMatch.score})`,
          newest: sql<string>`max(${propertyMatch.createdAt})`,
        })
        .from(propertyMatch)
        .where(and(inArray(propertyMatch.leadId, ids), eq(propertyMatch.active, true)))
        .groupBy(propertyMatch.leadId, propertyMatch.status)
    : [];

  const items = leadsRows.map((l) => {
    const mine = stats.filter((s) => s.leadId === l.leadId);
    const n = (st: MatchStatus) => mine.find((s) => s.status === st)?.n ?? 0;
    const suggested = mine.find((s) => s.status === "suggested");
    return {
      ...l,
      suggested: n("suggested"),
      sent: n("sent"),
      interested: n("interested"),
      bestScore: suggested ? Number(suggested.best) : null,
      newestSuggestionAt: suggested ? new Date(suggested.newest) : null,
    };
  });
  items.sort(
    (a, b) =>
      Number(b.hasProfile) - Number(a.hasProfile) ||
      b.suggested - a.suggested ||
      b.createdAt.getTime() - a.createdAt.getTime(),
  );
  return {
    items,
    totals: {
      leads: items.length,
      withoutProfile: items.filter((i) => !i.hasProfile).length,
      withSuggestions: items.filter((i) => i.suggested > 0).length,
      suggested: items.reduce((a, i) => a + i.suggested, 0),
      interested: items.reduce((a, i) => a + i.interested, 0),
    },
  };
}

/** Para el dashboard: sugerencias sin trabajar de mis leads (las más recientes primero). */
export async function myNewMatches(db: Db, ctx: RequestContext, limit = 5) {
  if (!hasPermission(ctx, "lead.read")) return null;
  const profiles = await db
    .select({ sp: searchProfile })
    .from(searchProfile)
    .innerJoin(lead, eq(lead.id, searchProfile.leadId))
    .where(openLeadsInScope(ctx, [eq(lead.assignedUserId, ctx.userId)]));
  if (!profiles.length) return { total: 0, lastWeek: 0, items: [] };
  await refreshFor(
    db,
    ctx.organizationId,
    profiles.map((p) => p.sp),
  );
  const leadIds = profiles.map((p) => p.sp.leadId);
  const base = and(
    inArray(propertyMatch.leadId, leadIds),
    eq(propertyMatch.status, "suggested"),
    eq(propertyMatch.active, true),
  );
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const [[total], [lastWeek], items] = await Promise.all([
    db.select({ n: count() }).from(propertyMatch).where(base),
    db
      .select({ n: count() })
      .from(propertyMatch)
      .where(and(base, gte(propertyMatch.createdAt, weekAgo))),
    db
      .select({
        id: propertyMatch.id,
        score: propertyMatch.score,
        createdAt: propertyMatch.createdAt,
        leadId: lead.id,
        contactName: contact.displayName,
        propertyId: property.id,
        code: property.code,
        title: property.title,
        type: property.type,
      })
      .from(propertyMatch)
      .innerJoin(lead, eq(lead.id, propertyMatch.leadId))
      .innerJoin(contact, eq(contact.id, lead.contactId))
      .innerJoin(property, eq(property.id, propertyMatch.propertyId))
      .where(base)
      .orderBy(desc(propertyMatch.createdAt), desc(propertyMatch.score))
      .limit(limit),
  ]);
  return {
    total: total?.n ?? 0,
    lastWeek: lastWeek?.n ?? 0,
    items: items.map((i) => ({ ...i, displayTitle: propertyDisplayTitle(i) })),
  };
}

/** El agente marca la sugerencia: enviada, le interesa o descartada (queda en el timeline). */
export async function setMatchStatus(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(setMatchStatusSchema, rawInput);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ m: propertyMatch, l: lead, code: property.code, title: property.title, type: property.type })
      .from(propertyMatch)
      .innerJoin(lead, eq(lead.id, propertyMatch.leadId))
      .innerJoin(property, eq(property.id, propertyMatch.propertyId))
      .where(and(eq(propertyMatch.id, input.matchId), eq(propertyMatch.organizationId, ctx.organizationId)))
      .for("update", { of: propertyMatch });
    if (!row || !hasPermission(ctx, "lead.read", leadRef(row.l))) throw new NotFoundError("Sugerencia");
    requirePermission(ctx, "lead.update", leadRef(row.l));
    requirePermission(ctx, "matching.run");
    if (row.m.status === input.status && input.note === row.m.note) return row.m;

    const now = new Date();
    const [after] = await tx
      .update(propertyMatch)
      .set({
        status: input.status,
        note: input.note ?? row.m.note,
        statusChangedAt: now,
        statusChangedById: ctx.userId,
        ...(input.status === "sent" && !row.m.sentAt ? { sentAt: now } : {}),
      })
      .where(eq(propertyMatch.id, row.m.id))
      .returning();
    const payload = {
      propertyId: row.m.propertyId,
      code: row.code,
      title: propertyDisplayTitle(row),
      status: input.status,
      score: row.m.score,
    };
    if (input.status === "sent" && row.m.status !== "sent") {
      await logActivity(tx, ctx, {
        type: "property_sent",
        contactId: row.l.contactId,
        leadId: row.l.id,
        direction: "outbound",
        body: input.note,
        payload,
      });
    } else if (input.status === "interested" || input.status === "discarded") {
      await logActivity(tx, ctx, {
        type: "match_feedback",
        contactId: row.l.contactId,
        leadId: row.l.id,
        body: input.note,
        payload,
      });
    }
    await writeAudit(tx, ctx, {
      action: "match.status",
      entityType: "lead",
      entityId: row.l.id,
      before: { status: row.m.status, propertyId: row.m.propertyId },
      after: { status: input.status, propertyId: row.m.propertyId, note: input.note },
    });
    return after;
  });
}

// ─── Comparables para tasación ─────────────────────────────────────────────

/**
 * Busca comparables en el inventario propio: mismo tipo, mismo barrio (o localidad si hay
 * pocos) y metraje ±35 %. Prefiere precios de cierre reales (operaciones cerradas) y si no, el
 * precio publicado. Devuelve la mediana de precio por m² y un valor sugerido.
 */
export async function suggestComparables(db: DbOrTx, ctx: RequestContext, rawQuery: unknown) {
  requirePermission(ctx, "property.read");
  const q = parseInput(comparablesQuerySchema, rawQuery);
  let subject = {
    id: null as string | null,
    type: q.type ?? null,
    localityId: q.localityId ?? null,
    neighborhoodId: q.neighborhoodId ?? null,
    area: q.areaM2 ?? null,
    bedrooms: q.bedrooms ?? null,
  };
  if (q.propertyId) {
    const [p] = await db
      .select()
      .from(property)
      .where(and(eq(property.id, q.propertyId), eq(property.organizationId, ctx.organizationId)));
    if (!p || !hasPermission(ctx, "property.read", propertyRef(p))) throw new NotFoundError("Propiedad");
    const area = p.builtArea ?? p.totalArea;
    subject = {
      id: p.id,
      type: subject.type ?? p.type,
      localityId: subject.localityId ?? p.localityId,
      neighborhoodId: subject.neighborhoodId ?? p.neighborhoodId,
      area: subject.area ?? (area ? Number(area) : null),
      bedrooms: subject.bedrooms ?? p.bedrooms,
    };
  }
  const currency: Currency = q.operation === "sale" ? "USD" : "UYU";
  const areaExpr = sql<string | null>`coalesce(${property.builtArea}, ${property.totalArea})`;

  const search = async (zone: "neighborhood" | "locality") => {
    const conditions: (SQL | undefined)[] = [
      eq(property.organizationId, ctx.organizationId),
      isNull(property.deletedAt),
      subject.type ? eq(property.type, subject.type as never) : undefined,
      notInArray(property.status, ["draft"]),
      sql`${q.operation}::property_operation = any(${property.operations})`,
      subject.id ? ne(property.id, subject.id) : undefined,
      zone === "neighborhood" && subject.neighborhoodId
        ? eq(property.neighborhoodId, subject.neighborhoodId)
        : undefined,
      zone === "locality" && subject.localityId ? eq(property.localityId, subject.localityId) : undefined,
      subject.area
        ? sql`${areaExpr} between ${Math.floor(subject.area * 0.65)} and ${Math.ceil(subject.area * 1.35)}`
        : undefined,
    ];
    return db
      .select({
        id: property.id,
        code: property.code,
        title: property.title,
        type: property.type,
        status: property.status,
        address: property.address,
        bedrooms: property.bedrooms,
        area: areaExpr,
        neighborhoodName: neighborhood.name,
        listCurrency: propertyPrice.currency,
        listMinor: propertyPrice.listMinor,
        updatedAt: property.updatedAt,
      })
      .from(property)
      .leftJoin(neighborhood, eq(neighborhood.id, property.neighborhoodId))
      .leftJoin(
        propertyPrice,
        and(eq(propertyPrice.propertyId, property.id), eq(propertyPrice.operation, q.operation)),
      )
      .where(and(...conditions))
      .orderBy(desc(property.updatedAt))
      .limit(60);
  };

  let zone: "neighborhood" | "locality" | "any" = subject.neighborhoodId ? "neighborhood" : "locality";
  let rows = await search(zone === "neighborhood" ? "neighborhood" : "locality");
  if (rows.length < 3 && zone === "neighborhood" && subject.localityId) {
    zone = "locality";
    rows = await search("locality");
  }
  if (!subject.neighborhoodId && !subject.localityId) zone = "any";

  const ids = rows.map((r) => r.id);
  const closed = ids.length
    ? await db
        .select({
          propertyId: deal.propertyId,
          currency: deal.currency,
          priceMinor: deal.priceMinor,
          closedAt: deal.closedAt,
        })
        .from(deal)
        .where(
          and(
            inArray(deal.propertyId, ids),
            eq(deal.operation, q.operation),
            inArray(deal.stage, ["signed", "closed"]),
            isNull(deal.deletedAt),
          ),
        )
        .orderBy(desc(deal.closedAt))
    : [];
  const rate = await orgRate(db, ctx.organizationId);

  const items = rows
    .map((r) => {
      const d = closed.find((c) => c.propertyId === r.id);
      const source = d ? ("closed" as const) : r.listMinor != null ? ("listed" as const) : null;
      if (!source) return null;
      const priceCurrency = d ? d.currency : (r.listCurrency as Currency);
      const priceMinor = d ? d.priceMinor : (r.listMinor as bigint);
      const inCurrency = convertMinor(priceMinor, priceCurrency, currency, rate);
      const areaM2 = r.area ? Number(r.area) : null;
      return {
        propertyId: r.id,
        code: r.code,
        displayTitle: propertyDisplayTitle(r),
        status: r.status,
        address: r.address,
        neighborhoodName: r.neighborhoodName,
        bedrooms: r.bedrooms,
        areaM2,
        source,
        closedAt: d?.closedAt ?? null,
        currency,
        priceMinor: inCurrency,
        pricePerM2Minor: areaM2 ? (inCurrency * 100n) / BigInt(Math.round(areaM2 * 100)) : null,
        bedroomDiff: subject.bedrooms !== null && r.bedrooms !== null ? r.bedrooms - subject.bedrooms : null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    // Primero cierres reales, después los de dormitorios parecidos.
    .sort(
      (a, b) =>
        Number(b.source === "closed") - Number(a.source === "closed") ||
        Math.abs(a.bedroomDiff ?? 0) - Math.abs(b.bedroomDiff ?? 0),
    )
    .slice(0, q.limit);

  const median = medianPricePerM2(
    items.filter((i) => i.areaM2).map((i) => ({ priceMinor: i.priceMinor, areaM2: i.areaM2 as number })),
  );
  const suggested =
    median !== null && subject.area ? (median * BigInt(Math.round(subject.area * 100))) / 100n : null;
  return {
    subject,
    zone,
    currency,
    items,
    medianPricePerM2Minor: median,
    suggestedValueMinor: suggested,
    confidence: comparableConfidence(items.filter((i) => i.areaM2).length),
    closedCount: items.filter((i) => i.source === "closed").length,
  };
}

/** Para el dashboard de matching: total de propiedades ofrecibles por operación. */
export async function matchableInventoryCount(db: DbOrTx, ctx: RequestContext) {
  requirePermission(ctx, "property.read");
  const rows = await db
    .select({ id: property.id, operations: property.operations })
    .from(property)
    .where(
      and(
        eq(property.organizationId, ctx.organizationId),
        isNull(property.deletedAt),
        inArray(property.status, [...MATCHABLE_PROPERTY_STATUSES]),
      ),
    )
    .orderBy(asc(property.code));
  const by = (op: PropertyOperation) => rows.filter((r) => r.operations.includes(op)).length;
  return { total: rows.length, sale: by("sale"), rent: by("rent"), temporaryRent: by("temporary_rent") };
}
