import { and, desc, eq, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import {
  agentGoal,
  branch,
  calendarEvent,
  deal,
  dealCommission,
  dealParticipant,
  dealStageEvent,
  lead,
  membership,
  property,
  user,
  type Db,
  type DbOrTx,
} from "@crm/db";
import {
  GOAL_METRICS,
  PERIODS,
  POINT_RULES,
  PROPERTY_OPERATIONS,
  money,
  percentage,
  periodRange,
  periodTarget,
  type Currency,
  type GoalMetric,
  type PropertyOperation,
} from "@crm/shared";
import { uuidSchema } from "@crm/shared/validation";
import type { ResourceRef } from "@crm/shared/rbac";
import { z } from "zod";
import { writeAudit } from "../audit";
import { hasPermission, requirePermission, type RequestContext } from "../context";
import { resolveAssignment } from "../crm/helpers";
import { ValidationError, parseInput } from "../errors";
import { getCommissionPlan } from "../deals/deals";
import { propertyDisplayTitle } from "../properties/helpers";

const isoDay = z.iso.date().optional().nullable().catch(null);

const metricsQuery = z.object({
  userId: uuidSchema.optional().catch(undefined),
  period: z.enum(PERIODS).catch("month").default("month"),
  from: isoDay,
  to: isoDay,
  operation: z.enum(["sale", "rent"]).optional().catch(undefined),
  today: z.iso.date(),
});

async function userRef(db: DbOrTx, ctx: RequestContext, userId: string): Promise<ResourceRef> {
  const { branchId, teamId } = await resolveAssignment(db, ctx.organizationId, userId);
  return { organizationId: ctx.organizationId, ownerUserId: userId, branchId, teamId };
}

/** Condición "la fecha local de `col` está en [from, to)". */
function inRange(col: SQL | unknown, tz: string, from: string, to: string): SQL {
  return sql`((${col} at time zone ${tz})::date >= ${from}::date and (${col} at time zone ${tz})::date < ${to}::date)`;
}

function participates(userId: string): SQL {
  return sql`exists (select 1 from deal_participant dp where dp.deal_id = ${deal.id} and dp.user_id = ${userId})`;
}

function opFilter(operation: "sale" | "rent" | undefined): SQL | undefined {
  if (!operation) return undefined;
  return operation === "sale"
    ? eq(deal.operation, "sale")
    : inArray(deal.operation, ["rent", "temporary_rent"]);
}

async function countsFor(
  db: DbOrTx,
  ctx: RequestContext,
  userId: string,
  from: string,
  to: string,
  operation: "sale" | "rent" | undefined,
): Promise<Record<GoalMetric, number>> {
  const tz = ctx.organization.timezone || "America/Montevideo";
  const org = ctx.organizationId;
  const propOps: PropertyOperation[] | null = operation
    ? operation === "sale"
      ? ["sale"]
      : ["rent", "temporary_rent"]
    : null;
  const n = sql<number>`count(*)::int`;
  const nd = sql<number>`count(distinct ${deal.id})::int`;
  const [[visits], [listed], [attended], [reserved], [signed], [sales], [rentals]] = await Promise.all([
    db
      .select({ n })
      .from(calendarEvent)
      .where(
        and(
          eq(calendarEvent.organizationId, org),
          eq(calendarEvent.assignedUserId, userId),
          eq(calendarEvent.type, "visit"),
          eq(calendarEvent.status, "done"),
          isNull(calendarEvent.deletedAt),
          inRange(calendarEvent.startsAt, tz, from, to),
        ),
      ),
    db
      .select({ n })
      .from(property)
      .where(
        and(
          eq(property.organizationId, org),
          isNull(property.deletedAt),
          sql`coalesce(${property.captadorUserId}, ${property.assignedUserId}) = ${userId}`,
          inRange(property.createdAt, tz, from, to),
          propOps
            ? sql`${property.operations} && ${`{${propOps.join(",")}}`}::property_operation[]`
            : undefined,
        ),
      ),
    db
      .select({ n })
      .from(lead)
      .where(
        and(
          eq(lead.organizationId, org),
          eq(lead.assignedUserId, userId),
          isNull(lead.deletedAt),
          isNotNull(lead.firstContactedAt),
          inRange(lead.firstContactedAt, tz, from, to),
        ),
      ),
    db
      .select({ n: nd })
      .from(dealStageEvent)
      .innerJoin(deal, eq(deal.id, dealStageEvent.dealId))
      .where(
        and(
          eq(dealStageEvent.organizationId, org),
          eq(dealStageEvent.toStage, "reserved"),
          inRange(dealStageEvent.occurredAt, tz, from, to),
          participates(userId),
          isNull(deal.deletedAt),
          opFilter(operation),
        ),
      ),
    db
      .select({ n: nd })
      .from(dealStageEvent)
      .innerJoin(deal, eq(deal.id, dealStageEvent.dealId))
      .where(
        and(
          eq(dealStageEvent.organizationId, org),
          inArray(dealStageEvent.toStage, ["signed", "closed"]),
          inRange(dealStageEvent.occurredAt, tz, from, to),
          participates(userId),
          isNull(deal.deletedAt),
          opFilter(operation),
        ),
      ),
    db
      .select({ n })
      .from(deal)
      .where(
        and(
          eq(deal.organizationId, org),
          eq(deal.stage, "closed"),
          eq(deal.operation, "sale"),
          sql`${deal.closedAt} >= ${from}::date and ${deal.closedAt} < ${to}::date`,
          participates(userId),
          isNull(deal.deletedAt),
          operation === "rent" ? sql`false` : undefined,
        ),
      ),
    db
      .select({ n })
      .from(deal)
      .where(
        and(
          eq(deal.organizationId, org),
          eq(deal.stage, "closed"),
          inArray(deal.operation, ["rent", "temporary_rent"]),
          sql`${deal.closedAt} >= ${from}::date and ${deal.closedAt} < ${to}::date`,
          participates(userId),
          isNull(deal.deletedAt),
          operation === "sale" ? sql`false` : undefined,
        ),
      ),
  ]);
  return {
    visits_done: visits?.n ?? 0,
    properties_listed: listed?.n ?? 0,
    leads_attended: attended?.n ?? 0,
    reservations: reserved?.n ?? 0,
    signed: signed?.n ?? 0,
    sales_closed: sales?.n ?? 0,
    rentals_closed: rentals?.n ?? 0,
  };
}

/** Metas mensuales efectivas de un usuario (individual o, si no tiene, la general). */
export async function goalsFor(db: DbOrTx, ctx: RequestContext, userId: string | null) {
  const rows = await db.select().from(agentGoal).where(eq(agentGoal.organizationId, ctx.organizationId));
  const out = {} as Record<GoalMetric, { target: number | null; source: "user" | "default" | null }>;
  for (const m of GOAL_METRICS) {
    const own = userId ? rows.find((r) => r.userId === userId && r.metric === m) : undefined;
    const def = rows.find((r) => r.userId === null && r.metric === m);
    out[m] = own
      ? { target: own.monthlyTarget, source: "user" }
      : def
        ? { target: def.monthlyTarget, source: "default" }
        : { target: null, source: null };
  }
  return out;
}

const saveGoalsSchema = z.object({
  userId: uuidSchema.nullable().default(null),
  goals: z.array(
    z.object({
      metric: z.enum(GOAL_METRICS),
      monthlyTarget: z.union([z.literal(""), z.null(), z.coerce.number().int().min(0).max(10_000)]),
    }),
  ),
});

/** Guarda metas: la general exige configuración; la individual, reportes sobre esa persona. */
export async function saveGoals(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(saveGoalsSchema, rawInput);
  if (input.userId === null) requirePermission(ctx, "settings.manage");
  else {
    const ref = await userRef(db, ctx, input.userId);
    if (!hasPermission(ctx, "settings.manage")) {
      requirePermission(ctx, "report.read", ref);
      requirePermission(ctx, "lead.assign", ref);
    }
  }
  return db.transaction(async (tx) => {
    const before = await goalsFor(tx, ctx, input.userId);
    for (const g of input.goals) {
      const userCond = input.userId === null ? isNull(agentGoal.userId) : eq(agentGoal.userId, input.userId);
      await tx
        .delete(agentGoal)
        .where(
          and(eq(agentGoal.organizationId, ctx.organizationId), userCond, eq(agentGoal.metric, g.metric)),
        );
      if (g.monthlyTarget !== "" && g.monthlyTarget !== null)
        await tx.insert(agentGoal).values({
          organizationId: ctx.organizationId,
          userId: input.userId,
          metric: g.metric,
          monthlyTarget: g.monthlyTarget,
        });
    }
    await writeAudit(tx, ctx, {
      action: "goals.update",
      entityType: "organization",
      entityId: input.userId ?? ctx.organizationId,
      before,
      after: input.goals,
    });
  });
}

/**
 * Métricas del parte: actividad del período contra la meta y contra el período anterior de
 * igual largo. Cada agente ve lo suyo; ver a otro exige `report.read` sobre esa persona.
 */
export async function activityMetrics(db: DbOrTx, ctx: RequestContext, rawQuery: unknown) {
  requirePermission(ctx, "dashboard.read");
  const q = parseInput(metricsQuery, rawQuery);
  const userId = q.userId ?? ctx.userId;
  if (userId !== ctx.userId) requirePermission(ctx, "report.read", await userRef(db, ctx, userId));
  const range = periodRange(q.period, q.today, { from: q.from, to: q.to });
  if (range.to <= range.from)
    throw new ValidationError("El rango es inválido", { to: ["Anterior al inicio"] });
  const days = Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86_400_000);
  if (days > 400) throw new ValidationError("El rango máximo es de 400 días", { to: ["Demasiado largo"] });
  const prevFrom = new Date(Date.parse(range.from) - days * 86_400_000).toISOString().slice(0, 10);

  const [current, previous, goals] = await Promise.all([
    countsFor(db, ctx, userId, range.from, range.to, q.operation),
    countsFor(db, ctx, userId, prevFrom, range.from, q.operation),
    goalsFor(db, ctx, userId),
  ]);

  // Facturación proyectada: honorarios de las operaciones cerradas en el período (tu parte).
  const plan = await getCommissionPlan(db, ctx);
  const fees = await db
    .select({
      currency: dealCommission.currency,
      amountMinor: dealCommission.amountMinor,
      share: dealParticipant.shareBasisPoints,
      rate: dealParticipant.agentRateBasisPoints,
    })
    .from(dealCommission)
    .innerJoin(deal, eq(deal.id, dealCommission.dealId))
    .innerJoin(dealParticipant, and(eq(dealParticipant.dealId, deal.id), eq(dealParticipant.userId, userId)))
    .where(
      and(
        eq(deal.organizationId, ctx.organizationId),
        eq(deal.stage, "closed"),
        sql`${deal.closedAt} >= ${range.from}::date and ${deal.closedAt} < ${range.to}::date`,
        sql`${dealCommission.status} <> 'cancelled'`,
        isNull(deal.deletedAt),
        opFilter(q.operation),
      ),
    );
  const projected: Record<Currency, bigint> = { USD: 0n, UYU: 0n };
  for (const f of fees)
    projected[f.currency] += percentage(
      percentage(money(f.amountMinor, f.currency), f.share),
      f.rate ?? plan.tiers[0]?.rateBasisPoints ?? 0,
    ).amountMinor;

  return {
    userId,
    range,
    metrics: GOAL_METRICS.map((m) => ({
      metric: m,
      value: current[m],
      previous: previous[m],
      target: goals[m].target === null ? null : periodTarget(goals[m].target, range.months),
      monthlyTarget: goals[m].target,
      goalSource: goals[m].source,
    })),
    projected,
    canSeeOthers: hasPermission(ctx, "report.read"),
  };
}

// ---------------------------------------------------------------------------------------------
// Competencia
// ---------------------------------------------------------------------------------------------

interface PointEvent {
  userId: string;
  points: number;
  kind: keyof typeof POINT_RULES;
  at: string;
  label: string;
}

/**
 * Ranking por puntos de la temporada (año calendario). Las reglas son fijas y visibles
 * (`POINT_RULES`). En operaciones compartidas los puntos se reparten según el % de cada uno.
 */
export async function competition(db: DbOrTx, ctx: RequestContext, opts: { year: number }) {
  requirePermission(ctx, "dashboard.read");
  const tz = ctx.organization.timezone || "America/Montevideo";
  const org = ctx.organizationId;
  const from = `${opts.year}-01-01`;
  const to = `${opts.year + 1}-01-01`;
  const plan = await getCommissionPlan(db, ctx);

  const [visits, listed, stageRows, fees, members] = await Promise.all([
    db
      .select({
        userId: calendarEvent.assignedUserId,
        at: calendarEvent.startsAt,
        title: calendarEvent.title,
      })
      .from(calendarEvent)
      .where(
        and(
          eq(calendarEvent.organizationId, org),
          eq(calendarEvent.type, "visit"),
          eq(calendarEvent.status, "done"),
          isNull(calendarEvent.deletedAt),
          inRange(calendarEvent.startsAt, tz, from, to),
        ),
      ),
    db
      .select({
        userId: sql<string>`coalesce(${property.captadorUserId}, ${property.assignedUserId})`,
        at: property.createdAt,
        code: property.code,
        title: property.title,
        type: property.type,
      })
      .from(property)
      .where(
        and(
          eq(property.organizationId, org),
          isNull(property.deletedAt),
          sql`coalesce(${property.captadorUserId}, ${property.assignedUserId}) is not null`,
          inRange(property.createdAt, tz, from, to),
        ),
      ),
    db
      .select({
        userId: dealParticipant.userId,
        share: dealParticipant.shareBasisPoints,
        to: dealStageEvent.toStage,
        at: dealStageEvent.occurredAt,
        code: deal.code,
      })
      .from(dealStageEvent)
      .innerJoin(deal, eq(deal.id, dealStageEvent.dealId))
      .innerJoin(dealParticipant, eq(dealParticipant.dealId, deal.id))
      .where(
        and(
          eq(dealStageEvent.organizationId, org),
          inArray(dealStageEvent.toStage, ["reserved", "closed"]),
          inRange(dealStageEvent.occurredAt, tz, from, to),
          isNull(deal.deletedAt),
        ),
      ),
    db
      .select({
        userId: dealParticipant.userId,
        share: dealParticipant.shareBasisPoints,
        rate: dealParticipant.agentRateBasisPoints,
        currency: dealCommission.currency,
        amountMinor: dealCommission.amountMinor,
        at: dealCommission.collectedAt,
        code: deal.code,
      })
      .from(dealCommission)
      .innerJoin(deal, eq(deal.id, dealCommission.dealId))
      .innerJoin(dealParticipant, eq(dealParticipant.dealId, deal.id))
      .where(
        and(
          eq(dealCommission.organizationId, org),
          eq(dealCommission.status, "collected"),
          sql`${dealCommission.collectedAt} >= ${from}::date and ${dealCommission.collectedAt} < ${to}::date`,
          isNull(deal.deletedAt),
        ),
      ),
    db
      .select({
        userId: user.id,
        name: user.name,
        branchId: membership.defaultBranchId,
        branchName: branch.name,
      })
      .from(membership)
      .innerJoin(user, eq(user.id, membership.userId))
      .leftJoin(branch, eq(branch.id, membership.defaultBranchId))
      .where(and(eq(membership.organizationId, org), eq(membership.status, "active"))),
  ]);

  const events: PointEvent[] = [];
  for (const v of visits)
    events.push({
      userId: v.userId,
      points: POINT_RULES.visit_done,
      kind: "visit_done",
      at: v.at.toISOString(),
      label: v.title,
    });
  for (const p of listed)
    events.push({
      userId: p.userId,
      points: POINT_RULES.property_listed,
      kind: "property_listed",
      at: p.at.toISOString(),
      label: `${p.code} · ${propertyDisplayTitle({ title: p.title, type: p.type, code: p.code })}`,
    });
  for (const s of stageRows) {
    const kind = s.to === "reserved" ? "reservation" : "deal_closed";
    events.push({
      userId: s.userId,
      points: (POINT_RULES[kind] * s.share) / 10_000,
      kind,
      at: s.at.toISOString(),
      label: s.code,
    });
  }
  const toUsd = (minor: bigint, currency: Currency) => {
    if (currency === "USD") return Number(minor) / 100;
    return Number(minor) / 100 / Number(plan.uyuPerUsd);
  };
  for (const f of fees) {
    const mine = percentage(
      percentage(money(f.amountMinor, f.currency), f.share),
      f.rate ?? plan.tiers[0]?.rateBasisPoints ?? 0,
    );
    const pts = (toUsd(mine.amountMinor, f.currency) / 1000) * POINT_RULES.per_thousand_usd;
    if (pts > 0)
      events.push({
        userId: f.userId,
        points: pts,
        kind: "per_thousand_usd",
        at: `${f.at}T12:00:00Z`,
        label: f.code,
      });
  }

  const round1 = (x: number) => Math.round(x * 10) / 10;
  const byUser = new Map<string, number>();
  for (const e of events) byUser.set(e.userId, (byUser.get(e.userId) ?? 0) + e.points);
  const agents = members
    .map((m) => ({ ...m, points: round1(byUser.get(m.userId) ?? 0) }))
    .filter((m) => m.points > 0 || m.userId === ctx.userId)
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name))
    .map((m, i) => ({ ...m, position: i + 1 }));
  const branches = new Map<string, { branchId: string; name: string; points: number; agents: number }>();
  for (const a of agents) {
    if (!a.branchId || !a.branchName) continue;
    const b = branches.get(a.branchId) ?? { branchId: a.branchId, name: a.branchName, points: 0, agents: 0 };
    b.points = round1(b.points + a.points);
    b.agents += 1;
    branches.set(a.branchId, b);
  }
  const me = agents.find((a) => a.userId === ctx.userId) ?? null;
  const podium = agents[2];
  return {
    year: opts.year,
    agents,
    branches: [...branches.values()]
      .sort((a, b) => b.points - a.points)
      .map((b, i) => ({ ...b, position: i + 1 })),
    me,
    toPodium: me && me.position > 3 && podium ? round1(podium.points - me.points) : 0,
    myMovements: events
      .filter((e) => e.userId === ctx.userId)
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 12)
      .map((e) => ({ ...e, points: round1(e.points) })),
  };
}

// ---------------------------------------------------------------------------------------------
// Mapa de cierres
// ---------------------------------------------------------------------------------------------

const mapQuery = z.object({
  range: z.enum(["all", "year", "12m"]).catch("all").default("all"),
  operation: z.enum(PROPERTY_OPERATIONS).optional().catch(undefined),
  today: z.iso.date(),
});

/**
 * Operaciones vendidas, alquiladas y reservadas con ubicación, más las propiedades activas
 * del usuario. Solo datos de la propiedad (sin clientes): lo ve quien ve el inventario.
 */
export async function closingMap(db: DbOrTx, ctx: RequestContext, rawQuery: unknown) {
  requirePermission(ctx, "property.read");
  const q = parseInput(mapQuery, rawQuery);
  const since =
    q.range === "year"
      ? `${q.today.slice(0, 4)}-01-01`
      : q.range === "12m"
        ? new Date(Date.parse(q.today) - 365 * 86_400_000).toISOString().slice(0, 10)
        : null;
  const rows = await db
    .select({
      dealId: deal.id,
      stage: deal.stage,
      operation: deal.operation,
      closedAt: deal.closedAt,
      stageChangedAt: deal.stageChangedAt,
      currency: deal.currency,
      priceMinor: deal.priceMinor,
      propertyId: property.id,
      code: property.code,
      title: property.title,
      type: property.type,
      latitude: property.latitude,
      longitude: property.longitude,
    })
    .from(deal)
    .innerJoin(property, eq(property.id, deal.propertyId))
    .where(
      and(
        eq(deal.organizationId, ctx.organizationId),
        isNull(deal.deletedAt),
        inArray(deal.stage, ["closed", "reserved", "notary", "signed"]),
        q.operation ? eq(deal.operation, q.operation) : undefined,
        since ? sql`coalesce(${deal.closedAt}, ${deal.stageChangedAt}::date) >= ${since}::date` : undefined,
      ),
    )
    .orderBy(desc(deal.stageChangedAt))
    .limit(5000);
  const mine = await db
    .select({
      propertyId: property.id,
      code: property.code,
      title: property.title,
      type: property.type,
      latitude: property.latitude,
      longitude: property.longitude,
    })
    .from(property)
    .where(
      and(
        eq(property.organizationId, ctx.organizationId),
        eq(property.assignedUserId, ctx.userId),
        isNull(property.deletedAt),
        inArray(property.status, ["available", "published", "negotiating", "reserved"]),
      ),
    );
  const points = rows.map((r) => ({
    id: r.dealId,
    kind: (r.stage === "closed" ? (r.operation === "sale" ? "sold" : "rented") : "reserved") as
      "sold" | "rented" | "reserved",
    propertyId: r.propertyId,
    label: `${r.code} · ${propertyDisplayTitle({ title: r.title, type: r.type, code: r.code })}`,
    lat: r.latitude ? Number(r.latitude) : null,
    lng: r.longitude ? Number(r.longitude) : null,
    date: r.closedAt ?? r.stageChangedAt.toISOString().slice(0, 10),
    currency: r.currency,
    priceMinor: r.priceMinor,
  }));
  return {
    points: points.filter((p) => p.lat !== null && p.lng !== null),
    withoutLocation: points.filter((p) => p.lat === null || p.lng === null).length,
    counts: {
      sold: points.filter((p) => p.kind === "sold").length,
      rented: points.filter((p) => p.kind === "rented").length,
      reserved: points.filter((p) => p.kind === "reserved").length,
    },
    mine: mine
      .filter((m) => m.latitude && m.longitude)
      .map((m) => ({
        propertyId: m.propertyId,
        label: `${m.code} · ${propertyDisplayTitle({ title: m.title, type: m.type, code: m.code })}`,
        lat: Number(m.latitude),
        lng: Number(m.longitude),
      })),
  };
}
