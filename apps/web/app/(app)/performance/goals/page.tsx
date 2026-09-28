import { activityMetrics, goalsFor, hasPermission, listDealUsers } from "@crm/core";
import { getDb } from "@crm/db";
import { GOAL_METRIC_LABELS, PERIOD_LABELS, PERIODS, type Period } from "@crm/shared";
import { ArrowDown, ArrowUp, Info, LineChart } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { GoalsEditorButton } from "@/components/performance/goals-editor";
import { price } from "@/components/properties/format";
import { Badge, Card, PageHeader } from "@/components/ui/misc";
import { requirePagePermission } from "@/lib/session";
import { DEFAULT_TZ, addDays, ymdInTz } from "@/lib/tz";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Métricas del parte" };

const dayFmt = (ymd: string) => ymd.split("-").reverse().join("/");

export default async function GoalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { ctx, user } = await requirePagePermission("dashboard.read");
  const params = await searchParams;
  const db = getDb();
  const today = ymdInTz(new Date(), ctx.organization.timezone || DEFAULT_TZ);
  const period = (PERIODS as readonly string[]).includes(params.period ?? "")
    ? (params.period as Period)
    : "week";
  const canOthers = hasPermission(ctx, "report.read");
  const users = canOthers ? await listDealUsers(db, ctx) : [];
  const r = await activityMetrics(db, ctx, {
    userId: canOthers ? params.user : undefined,
    period,
    from: params.from,
    to: params.to,
    operation: params.operation,
    today,
  });
  const whoName = users.find((u) => u.userId === r.userId)?.name ?? user.name;
  const canEditDefault = hasPermission(ctx, "settings.manage");
  const canEditUser = canEditDefault || (canOthers && hasPermission(ctx, "lead.assign"));
  const userGoals = canEditUser && r.userId !== ctx.userId ? await goalsFor(db, ctx, r.userId) : null;
  const defaults = canEditDefault ? await goalsFor(db, ctx, null) : null;

  const href = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...params, ...patch })) if (v) next.set(k, v);
    return `?${next.toString()}`;
  };

  return (
    <>
      {r.userId === ctx.userId && !canOthers && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-primary/30 bg-primary-soft/40 px-4 py-3 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <p>
            <strong>Estás viendo solo tus números.</strong> El reporte de la oficina o del equipo lo ven
            gerencia y supervisión.
          </p>
        </div>
      )}
      <PageHeader
        title="Métricas del parte"
        description={`Actividad de ${r.userId === ctx.userId ? "tu" : whoName.split(" ")[0] + ","} período contra la meta · datos reales del CRM`}
        actions={
          <>
            {defaults && (
              <GoalsEditorButton
                userId={null}
                current={Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, v.target]))}
              />
            )}
            {userGoals && (
              <GoalsEditorButton
                userId={r.userId}
                userName={whoName}
                current={Object.fromEntries(
                  Object.entries(userGoals).map(([k, v]) => [k, v.source === "user" ? v.target : null]),
                )}
              />
            )}
          </>
        }
      />

      <Card className="mb-5 flex flex-wrap items-center gap-3 p-3">
        <nav aria-label="Período" className="flex rounded-md border p-0.5 text-sm">
          {PERIODS.filter((p) => p !== "custom").map((p) => (
            <Link
              key={p}
              href={href({ period: p, from: undefined, to: undefined })}
              className={cn(
                "rounded px-3 py-1",
                period === p ? "bg-primary text-primary-foreground" : "text-muted-foreground",
              )}
            >
              {PERIOD_LABELS[p]}
            </Link>
          ))}
        </nav>
        <form className="flex items-center gap-1.5 text-sm" action="">
          <input type="hidden" name="period" value="custom" />
          {params.user && <input type="hidden" name="user" value={params.user} />}
          {params.operation && <input type="hidden" name="operation" value={params.operation} />}
          <input
            type="date"
            name="from"
            defaultValue={period === "custom" ? r.range.from : ""}
            aria-label="Desde"
            className="h-8 rounded-md border px-2"
          />
          <input
            type="date"
            name="to"
            defaultValue={period === "custom" ? addDays(r.range.to, -1) : ""}
            aria-label="Hasta"
            className="h-8 rounded-md border px-2"
          />
          <button
            type="submit"
            className="h-8 rounded-md border px-3 text-muted-foreground hover:bg-surface-muted"
          >
            Ver
          </button>
        </form>
        <nav aria-label="Operación" className="flex rounded-md border p-0.5 text-sm">
          {[
            { k: undefined, l: "Todas" },
            { k: "sale", l: "Venta" },
            { k: "rent", l: "Alquiler" },
          ].map((o) => (
            <Link
              key={o.l}
              href={href({ operation: o.k })}
              className={cn(
                "rounded px-3 py-1",
                params.operation === o.k ? "bg-primary text-primary-foreground" : "text-muted-foreground",
              )}
            >
              {o.l}
            </Link>
          ))}
        </nav>
        <span className="ml-auto text-xs text-muted-foreground">
          {dayFmt(r.range.from)} – {dayFmt(addDays(r.range.to, -1))}
        </span>
      </Card>

      {canOthers && (
        <nav aria-label="Agente" className="mb-5 flex flex-wrap gap-1.5 text-xs">
          {users.map((u) => (
            <Link
              key={u.userId}
              href={href({ user: u.userId })}
              className={cn(
                "rounded-full border px-3 py-1",
                u.userId === r.userId
                  ? "border-primary bg-primary-soft text-primary"
                  : "text-muted-foreground",
              )}
            >
              {u.name}
            </Link>
          ))}
        </nav>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {r.metrics.map((m) => {
          const pct = m.target ? Math.round((m.value / m.target) * 100) : null;
          const delta = m.previous ? Math.round(((m.value - m.previous) / m.previous) * 100) : null;
          return (
            <Card key={m.metric} className="rounded-xl p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm text-muted-foreground" title={GOAL_METRIC_LABELS[m.metric].hint}>
                  {GOAL_METRIC_LABELS[m.metric].label}
                </p>
                {pct !== null && (
                  <Badge tone={pct >= 100 ? "success" : pct >= 50 ? "warning" : "danger"}>{pct} %</Badge>
                )}
              </div>
              <p className="mt-2 text-3xl font-bold tabular">{m.value}</p>
              {m.target !== null ? (
                <>
                  <p className="text-xs text-muted-foreground">
                    Meta <strong className="text-foreground">{m.target}</strong>
                    {m.value < m.target ? ` · faltan ${m.target - m.value}` : " · cumplida"}
                  </p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden>
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.min(100, pct ?? 0)}%` }}
                    />
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">Sin meta</p>
              )}
              <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                {delta === null ? (
                  `${m.previous} en el período anterior`
                ) : (
                  <>
                    {delta >= 0 ? (
                      <ArrowUp className="size-3 text-success" aria-hidden />
                    ) : (
                      <ArrowDown className="size-3 text-danger" aria-hidden />
                    )}
                    <span className={delta >= 0 ? "text-success" : "text-danger"}>{Math.abs(delta)} %</span>{" "}
                    vs período anterior
                  </>
                )}
              </p>
            </Card>
          );
        })}
        <Card className="rounded-xl p-4">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            Facturación del período
            <LineChart className="size-4" aria-hidden />
          </div>
          <p className="mt-2 text-2xl font-bold tabular">
            {r.projected.USD > 0n || r.projected.UYU === 0n
              ? price(r.projected.USD, "USD")
              : price(r.projected.UYU, "UYU")}
          </p>
          {r.projected.USD > 0n && r.projected.UYU > 0n && (
            <p className="text-sm font-semibold tabular">+ {price(r.projected.UYU, "UYU")}</p>
          )}
          <p className="text-xs text-muted-foreground">Tu parte de los honorarios de operaciones cerradas</p>
        </Card>
      </div>
    </>
  );
}
