import { and, asc, eq, gte, inArray, isNull, lt, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  activity,
  branch,
  commissionSettings,
  deal,
  dealCommission,
  lead,
  membership,
  property,
  propertyPriceHistory,
  rentalContract,
  rentCharge,
  user,
  type DbOrTx,
} from "@crm/db";
import type { Currency } from "@crm/shared/money";
import { PERIODS, periodRange } from "@crm/shared/performance";
import { funnelCounts, furthestStage, lastMonths, median, pct } from "@crm/shared/reports";
import type { LeadStatus } from "@crm/shared/crm";
import { scopeCondition } from "../access-filter";
import { hasPermission, requirePermission, type RequestContext } from "../context";
import { ValidationError, parseInput } from "../errors";

const ymd = z.iso.date().optional().nullable();
export const reportQuerySchema = z.object({
  period: z.enum(PERIODS).catch("month"),
  from: ymd.catch(null),
  to: ymd.catch(null),
  today: z.iso.date(),
  branchId: z.uuid().optional().nullable().catch(null),
  userId: z.uuid().optional().nullable().catch(null),
});
export type ReportQuery = z.input<typeof reportQuerySchema>;

type Cols = { ownerUserId: AnyColumn; teamId: AnyColumn; branchId: AnyColumn };

function filters(ctx: RequestContext, q: z.output<typeof reportQuerySchema>, cols: Cols): SQL[] {
  return [
    scopeCondition(ctx, "report.read", cols),
    ...(q.branchId ? [eq(cols.branchId, q.branchId)] : []),
    ...(q.userId ? [eq(cols.ownerUserId, q.userId)] : []),
  ];
}

function parse(ctx: RequestContext, raw: unknown) {
  requirePermission(ctx, "report.read");
  const q = parseInput(reportQuerySchema, raw);
  const range = periodRange(q.period, q.today, { from: q.from, to: q.to });
  const days = (Date.parse(range.to) - Date.parse(range.from)) / 86_400_000;
  if (days <= 0) throw new ValidationError("El rango es inválido", { to: ["Anterior al inicio"] });
  if (days > 800) throw new ValidationError("El rango máximo es de dos años", { to: ["Demasiado largo"] });
  return { q, range };
}

async function names(db: DbOrTx, ids: readonly (string | null)[]) {
  const list = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (!list.length) return new Map<string, string>();
  const rows = await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, list));
  return new Map(rows.map((r) => [r.id, r.name]));
}

async function usdRate(db: DbOrTx, organizationId: string): Promise<number> {
  const [s] = await db
    .select({ r: commissionSettings.uyuPerUsd })
    .from(commissionSettings)
    .where(eq(commissionSettings.organizationId, organizationId));
  return s ? Number(s.r) : 40;
}

/** Filtros disponibles según el alcance de `report.read`. */
export async function reportFilters(db: DbOrTx, ctx: RequestContext) {
  requirePermission(ctx, "report.read");
  const [branches, users] = await Promise.all([
    db
      .select({ id: branch.id, name: branch.name })
      .from(branch)
      .where(and(eq(branch.organizationId, ctx.organizationId), isNull(branch.deletedAt)))
      .orderBy(asc(branch.name)),
    db
      .select({ id: user.id, name: user.name, branchId: membership.defaultBranchId })
      .from(membership)
      .innerJoin(user, eq(user.id, membership.userId))
      .where(and(eq(membership.organizationId, ctx.organizationId), eq(membership.status, "active")))
      .orderBy(asc(user.name)),
  ]);
  const all = hasPermission(ctx, "report.read", { organizationId: ctx.organizationId });
  return { branches: all ? branches : branches.filter((b) => ctx.subject.branchIds.includes(b.id)), users };
}

// ─── Comercial ─────────────────────────────────────────────────────────────

export async function commercialReport(db: DbOrTx, ctx: RequestContext, raw: unknown) {
  const { q, range } = parse(ctx, raw);
  const cols = { ownerUserId: lead.assignedUserId, teamId: lead.teamId, branchId: lead.branchId };
  const leads = await db
    .select({
      id: lead.id,
      status: lead.status,
      source: lead.source,
      operation: lead.operation,
      assignedUserId: lead.assignedUserId,
      lostReason: lead.lostReason,
      createdAt: lead.createdAt,
      firstContactedAt: lead.firstContactedAt,
    })
    .from(lead)
    .where(
      and(
        eq(lead.organizationId, ctx.organizationId),
        isNull(lead.deletedAt),
        gte(lead.createdAt, new Date(`${range.from}T00:00:00-03:00`)),
        lt(lead.createdAt, new Date(`${range.to}T00:00:00-03:00`)),
        ...filters(ctx, q, cols),
      ),
    )
    .limit(20_000);
  const ids = leads.map((l) => l.id);
  const history = new Map<string, string[]>();
  for (let i = 0; i < ids.length; i += 2000) {
    const chunk = ids.slice(i, i + 2000);
    const rows = await db
      .select({ leadId: activity.leadId, to: sql<string | null>`${activity.payload}->>'to'` })
      .from(activity)
      .where(and(inArray(activity.leadId, chunk), eq(activity.type, "lead_status_changed")));
    for (const r of rows)
      if (r.leadId && r.to) history.set(r.leadId, [...(history.get(r.leadId) ?? []), r.to]);
  }
  const reached = leads.map((l) => furthestStage(l.status as LeadStatus, history.get(l.id) ?? []));
  const responseHours = (list: typeof leads) =>
    median(
      list
        .filter((l) => l.firstContactedAt)
        .map((l) => ((l.firstContactedAt?.getTime() ?? 0) - l.createdAt.getTime()) / 3_600_000),
    );
  const summarize = (list: typeof leads) => {
    const contacted = list.filter((l) => l.firstContactedAt || l.status !== "new").length;
    const won = list.filter((l) => l.status === "won").length;
    const lost = list.filter((l) => l.status === "lost").length;
    return {
      leads: list.length,
      contacted,
      won,
      lost,
      open: list.length - won - lost,
      contactRate: pct(contacted, list.length),
      conversion: pct(won, list.length),
      responseHours: responseHours(list),
    };
  };
  const group = <K extends string | null>(key: (l: (typeof leads)[number]) => K) => {
    const m = new Map<K, typeof leads>();
    for (const l of leads) m.set(key(l), [...(m.get(key(l)) ?? []), l]);
    return m;
  };
  const userNames = await names(
    db,
    leads.map((l) => l.assignedUserId),
  );
  const bySource = [...group((l) => l.source)].map(([source, list]) => ({ source, ...summarize(list) }));
  const byAgent = [...group((l) => l.assignedUserId)].map(([userId, list]) => ({
    userId,
    name: userId ? (userNames.get(userId) ?? "—") : "Sin asignar",
    ...summarize(list),
  }));
  const lostReasons = [...group((l) => (l.status === "lost" ? (l.lostReason ?? "other") : null))]
    .filter(([k]) => k !== null)
    .map(([reason, list]) => ({ reason: reason as string, count: list.length }))
    .sort((a, b) => b.count - a.count);

  // Tendencia: leads creados por mes (últimos 12 meses), mismo alcance.
  const months = lastMonths(q.today, 12);
  const trendRows = await db
    .select({
      ym: sql<string>`to_char(${lead.createdAt} at time zone 'America/Montevideo', 'YYYY-MM')`,
      n: sql<number>`count(*)::int`,
    })
    .from(lead)
    .where(
      and(
        eq(lead.organizationId, ctx.organizationId),
        isNull(lead.deletedAt),
        gte(lead.createdAt, new Date(`${months[0]}-01T00:00:00-03:00`)),
        ...filters(ctx, q, cols),
      ),
    )
    .groupBy(sql`1`);
  return {
    range,
    totals: summarize(leads),
    funnel: funnelCounts(reached),
    bySource: bySource.sort((a, b) => b.leads - a.leads),
    byAgent: byAgent.sort((a, b) => b.won - a.won || b.leads - a.leads),
    lostReasons,
    trend: months.map((ym) => ({ ym, value: trendRows.find((r) => r.ym === ym)?.n ?? 0 })),
  };
}

// ─── Operaciones y honorarios ──────────────────────────────────────────────

export async function operationsReport(db: DbOrTx, ctx: RequestContext, raw: unknown) {
  const { q, range } = parse(ctx, raw);
  const cols = { ownerUserId: deal.assignedUserId, teamId: deal.teamId, branchId: deal.branchId };
  const rate = await usdRate(db, ctx.organizationId);
  const closed = await db
    .select({
      id: deal.id,
      code: deal.code,
      operation: deal.operation,
      currency: deal.currency,
      priceMinor: deal.priceMinor,
      assignedUserId: deal.assignedUserId,
      createdAt: deal.createdAt,
      closedAt: deal.closedAt,
      publishedAt: property.publishedAt,
      propertyCreatedAt: property.createdAt,
      propertyCode: property.code,
    })
    .from(deal)
    .innerJoin(property, eq(property.id, deal.propertyId))
    .where(
      and(
        eq(deal.organizationId, ctx.organizationId),
        isNull(deal.deletedAt),
        eq(deal.stage, "closed"),
        sql`${deal.closedAt} >= ${range.from}::date and ${deal.closedAt} < ${range.to}::date`,
        ...filters(ctx, q, cols),
      ),
    )
    .limit(10_000);
  const fallen = await db
    .select({ reason: deal.fallenReason, n: sql<number>`count(*)::int` })
    .from(deal)
    .where(
      and(
        eq(deal.organizationId, ctx.organizationId),
        isNull(deal.deletedAt),
        eq(deal.stage, "fallen"),
        gte(deal.stageChangedAt, new Date(`${range.from}T00:00:00-03:00`)),
        lt(deal.stageChangedAt, new Date(`${range.to}T00:00:00-03:00`)),
        ...filters(ctx, q, cols),
      ),
    )
    .groupBy(deal.fallenReason);
  const ids = closed.map((d) => d.id);
  const fees = ids.length
    ? await db
        .select({
          dealId: dealCommission.dealId,
          currency: dealCommission.currency,
          amountMinor: dealCommission.amountMinor,
          status: dealCommission.status,
        })
        .from(dealCommission)
        .where(and(inArray(dealCommission.dealId, ids), sql`${dealCommission.status} <> 'cancelled'`))
    : [];
  const toUsd = (minor: bigint, currency: Currency) => {
    const v = Number(minor) / 100;
    return currency === "USD" ? v : v / rate;
  };
  const days = (a: Date | string | null, b: string | null) =>
    a && b ? Math.max(0, Math.round((Date.parse(b) - new Date(a).getTime()) / 86_400_000)) : null;
  const volume: Record<Currency, bigint> = { USD: 0n, UYU: 0n };
  const feeTotals = { pending: { USD: 0n, UYU: 0n }, collected: { USD: 0n, UYU: 0n } };
  for (const d of closed) volume[d.currency] += d.priceMinor;
  for (const f of fees)
    feeTotals[f.status === "collected" ? "collected" : "pending"][f.currency] += f.amountMinor;
  const userNames = await names(
    db,
    closed.map((d) => d.assignedUserId),
  );
  const agents = new Map<
    string,
    { name: string; deals: number; sales: number; rentals: number; volumeUsd: number; feesUsd: number }
  >();
  for (const d of closed) {
    const k = d.assignedUserId ?? "none";
    const a = agents.get(k) ?? {
      name: d.assignedUserId ? (userNames.get(d.assignedUserId) ?? "—") : "Sin asignar",
      deals: 0,
      sales: 0,
      rentals: 0,
      volumeUsd: 0,
      feesUsd: 0,
    };
    a.deals++;
    if (d.operation === "sale") a.sales++;
    else a.rentals++;
    a.volumeUsd += toUsd(d.priceMinor, d.currency);
    a.feesUsd += fees
      .filter((f) => f.dealId === d.id)
      .reduce((s, f) => s + toUsd(f.amountMinor, f.currency), 0);
    agents.set(k, a);
  }
  const months = lastMonths(q.today, 12);
  const trendRows = await db
    .select({ ym: sql<string>`to_char(${deal.closedAt}, 'YYYY-MM')`, n: sql<number>`count(*)::int` })
    .from(deal)
    .where(
      and(
        eq(deal.organizationId, ctx.organizationId),
        isNull(deal.deletedAt),
        eq(deal.stage, "closed"),
        sql`${deal.closedAt} >= ${`${months[0]}-01`}::date`,
        ...filters(ctx, q, cols),
      ),
    )
    .groupBy(sql`1`);
  return {
    range,
    rate,
    totals: {
      closed: closed.length,
      sales: closed.filter((d) => d.operation === "sale").length,
      rentals: closed.filter((d) => d.operation !== "sale").length,
      fallen: fallen.reduce((s, f) => s + f.n, 0),
      volume,
      fees: feeTotals,
      daysToClose: median(
        closed.map((d) => days(d.createdAt, d.closedAt)).filter((x): x is number => x !== null),
      ),
      daysOnMarket: median(
        closed
          .map((d) => days(d.publishedAt ?? d.propertyCreatedAt, d.closedAt))
          .filter((x): x is number => x !== null),
      ),
    },
    byAgent: [...agents.entries()]
      .map(([userId, a]) => ({
        userId,
        ...a,
        volumeUsd: Math.round(a.volumeUsd),
        feesUsd: Math.round(a.feesUsd),
      }))
      .sort((a, b) => b.feesUsd - a.feesUsd || b.deals - a.deals),
    fallenReasons: fallen
      .map((f) => ({ reason: f.reason?.trim() || "Sin motivo", count: f.n }))
      .sort((a, b) => b.count - a.count),
    deals: closed.map((d) => ({
      id: d.id,
      code: d.code,
      propertyCode: d.propertyCode,
      operation: d.operation,
      currency: d.currency,
      priceMinor: d.priceMinor.toString(),
      closedAt: d.closedAt,
      agent: d.assignedUserId ? (userNames.get(d.assignedUserId) ?? "—") : "Sin asignar",
    })),
    trend: months.map((ym) => ({ ym, value: trendRows.find((r) => r.ym === ym)?.n ?? 0 })),
  };
}

// ─── Alquileres ────────────────────────────────────────────────────────────

export async function rentalsReport(db: DbOrTx, ctx: RequestContext, raw: unknown) {
  const { q, range } = parse(ctx, raw);
  const cols = {
    ownerUserId: rentalContract.assignedUserId,
    teamId: rentalContract.teamId,
    branchId: rentalContract.branchId,
  };
  const base = [
    eq(rentalContract.organizationId, ctx.organizationId),
    isNull(rentalContract.deletedAt),
    ...filters(ctx, q, cols),
  ];
  const [active] = await db
    .select({
      n: sql<number>`count(*) filter (where ${rentalContract.status} = 'active')::int`,
      ending: sql<number>`count(*) filter (where ${rentalContract.status} = 'active' and ${rentalContract.endDate} < (${q.today}::date + 90))::int`,
      started: sql<number>`count(*) filter (where ${rentalContract.startDate} >= ${range.from}::date and ${rentalContract.startDate} < ${range.to}::date)::int`,
    })
    .from(rentalContract)
    .where(and(...base));
  const charges = await db
    .select({
      currency: rentCharge.currency,
      dueDate: rentCharge.dueDate,
      total: sql<string>`coalesce((select sum(case when l.kind = 'discount' then -l.amount_minor else l.amount_minor end) from rent_charge_line l where l.charge_id = "rent_charge"."id"), 0)`,
      paid: sql<string>`coalesce((select sum(p.amount_minor) from rent_payment p where p.charge_id = "rent_charge"."id"), 0)`,
    })
    .from(rentCharge)
    .innerJoin(rentalContract, eq(rentalContract.id, rentCharge.contractId))
    .where(and(...base, sql`${rentCharge.dueDate} < ${range.to}::date`))
    .limit(50_000);
  const zero = () => ({ USD: 0n, UYU: 0n }) as Record<Currency, bigint>;
  const billed = zero();
  const collected = zero();
  const overdue = zero();
  let overdueCount = 0;
  for (const c of charges) {
    const total = BigInt(c.total);
    const paid = BigInt(c.paid);
    if (c.dueDate >= range.from) {
      billed[c.currency] += total;
      collected[c.currency] += paid < total ? paid : total;
    }
    if (c.dueDate < q.today && total > paid) {
      overdue[c.currency] += total - paid;
      overdueCount++;
    }
  }
  const [settled] = await db
    .select({
      usd: sql<string>`coalesce(sum(s.net_minor) filter (where s.currency = 'USD'), 0)`,
      uyu: sql<string>`coalesce(sum(s.net_minor) filter (where s.currency = 'UYU'), 0)`,
      n: sql<number>`count(*)::int`,
    })
    .from(sql`owner_settlement s`)
    .innerJoin(rentCharge, sql`${rentCharge.id} = s.charge_id`)
    .innerJoin(rentalContract, eq(rentalContract.id, rentCharge.contractId))
    .where(
      and(
        ...base,
        sql`s.status = 'paid' and s.paid_at >= ${range.from}::date and s.paid_at < ${range.to}::date`,
      ),
    );
  const rateOf = (cur: Currency) =>
    billed[cur] > 0n ? Number((collected[cur] * 1000n) / billed[cur]) / 10 : null;
  return {
    range,
    activeContracts: active?.n ?? 0,
    endingSoon: active?.ending ?? 0,
    started: active?.started ?? 0,
    billed,
    collected,
    collectionRate: { USD: rateOf("USD"), UYU: rateOf("UYU") },
    overdue,
    overdueCount,
    settlements: { count: settled?.n ?? 0, USD: BigInt(settled?.usd ?? 0), UYU: BigInt(settled?.uyu ?? 0) },
  };
}

// ─── Inventario (foto actual) ──────────────────────────────────────────────

export async function inventoryReport(db: DbOrTx, ctx: RequestContext, raw: unknown) {
  const { q, range } = parse(ctx, raw);
  const cols = { ownerUserId: property.assignedUserId, teamId: property.teamId, branchId: property.branchId };
  const base = [
    eq(property.organizationId, ctx.organizationId),
    isNull(property.deletedAt),
    ...filters(ctx, q, cols),
  ];
  const [byStatus, byType, stale, drops] = await Promise.all([
    db
      .select({ status: property.status, n: sql<number>`count(*)::int` })
      .from(property)
      .where(and(...base))
      .groupBy(property.status),
    db
      .select({ type: property.type, n: sql<number>`count(*)::int` })
      .from(property)
      .where(and(...base, inArray(property.status, ["available", "published", "negotiating"])))
      .groupBy(property.type),
    db
      .select({
        id: property.id,
        code: property.code,
        title: property.title,
        since: sql<string>`coalesce(${property.publishedAt}, ${property.createdAt})::date::text`,
        agent: user.name,
      })
      .from(property)
      .leftJoin(user, eq(user.id, property.assignedUserId))
      .where(
        and(
          ...base,
          inArray(property.status, ["available", "published"]),
          sql`coalesce(${property.publishedAt}, ${property.createdAt}) < now() - interval '90 days'`,
        ),
      )
      .orderBy(sql`coalesce(${property.publishedAt}, ${property.createdAt})`)
      .limit(15),
    db
      .select({ n: sql<number>`count(distinct ${propertyPriceHistory.propertyId})::int` })
      .from(propertyPriceHistory)
      .innerJoin(property, eq(property.id, propertyPriceHistory.propertyId))
      .where(
        and(
          ...base,
          eq(propertyPriceHistory.field, "list"),
          sql`${propertyPriceHistory.newMinor} < ${propertyPriceHistory.oldMinor}`,
          gte(propertyPriceHistory.changedAt, new Date(`${range.from}T00:00:00-03:00`)),
          lt(propertyPriceHistory.changedAt, new Date(`${range.to}T00:00:00-03:00`)),
        ),
      ),
  ]);
  const [age] = await db
    .select({
      avg: sql<
        number | null
      >`round(avg(extract(epoch from now() - coalesce(${property.publishedAt}, ${property.createdAt})) / 86400))::int`,
    })
    .from(property)
    .where(and(...base, inArray(property.status, ["available", "published", "negotiating"])));
  const active = byType.reduce((s, t) => s + t.n, 0);
  return {
    range,
    active,
    byStatus: byStatus.sort((a, b) => b.n - a.n),
    byType: byType.sort((a, b) => b.n - a.n),
    avgDaysOnMarket: age?.avg ?? null,
    priceDrops: drops[0]?.n ?? 0,
    stale: stale.map((s) => ({
      ...s,
      days: Math.round((Date.parse(q.today) - Date.parse(s.since)) / 86_400_000),
    })),
  };
}
