import { commercialReport, inventoryReport, operationsReport, rentalsReport, reportFilters } from "@crm/core";
import { getDb } from "@crm/db";
import {
  LEAD_LOST_REASON_LABELS,
  LEAD_SOURCE_LABELS,
  PROPERTY_STATUS_LABELS,
  PROPERTY_TYPE_LABELS,
  type LeadLostReason,
  type LeadSource,
  type PropertyStatus,
  type PropertyType,
} from "@crm/shared";
import { PERIOD_LABELS, PERIODS, type Period } from "@crm/shared/performance";
import { REPORT_TAB_LABELS, REPORT_TABS, type FunnelStage, type ReportTab } from "@crm/shared/reports";
import { LEAD_STATUS_LABELS } from "@crm/shared/crm";
import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { formatDay, price } from "@/components/properties/format";
import { HBars, Kpi, MonthlyBars } from "@/components/reports/charts";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Card, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requirePagePermission } from "@/lib/session";
import { DEFAULT_TZ, ymdInTz } from "@/lib/tz";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Reportes" };

type Params = Record<string, string | undefined>;

const pctText = (v: number | null) => (v === null ? "—" : `${v} %`);
const hoursText = (h: number | null) =>
  h === null
    ? "—"
    : h < 1
      ? `${Math.round(h * 60)} min`
      : h < 48
        ? `${h.toFixed(1).replace(".", ",")} h`
        : `${Math.round(h / 24)} días`;
const usd = (n: number) => `U$S ${n.toLocaleString("es-UY")}`;
const both = (m: { USD: bigint; UYU: bigint }) =>
  [m.USD ? price(m.USD, "USD") : null, m.UYU ? price(m.UYU, "UYU") : null].filter(Boolean).join(" + ") || "—";

function Section({
  title,
  description,
  exportHref,
  children,
}: {
  title: string;
  description?: string;
  exportHref?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        {exportHref && (
          <Button size="sm" variant="ghost" asChild>
            <a href={exportHref}>
              <Download /> CSV
            </a>
          </Button>
        )}
      </div>
      <div className="p-4">{children}</div>
    </Card>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { ctx } = await requirePagePermission("report.read");
  const p = await searchParams;
  const db = getDb();
  const tab: ReportTab = REPORT_TABS.includes(p.tab as ReportTab) ? (p.tab as ReportTab) : "commercial";
  const period: Period = PERIODS.includes(p.period as Period) ? (p.period as Period) : "month";
  const today = ymdInTz(new Date(), ctx.organization.timezone || DEFAULT_TZ);
  const query = {
    period,
    from: p.from || null,
    to: p.to || null,
    today,
    branchId: p.branch || null,
    userId: p.user || null,
  };
  const keep = { tab, period, from: p.from, to: p.to, branch: p.branch, user: p.user };
  const qs = (patch: Params) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...keep, ...patch })) if (v) q.set(k, v);
    return `?${q.toString()}`;
  };
  const exportHref = (table: string) => `/api/reports/export${qs({ table })}`;
  const filters = await reportFilters(db, ctx);
  const chip = (active: boolean) =>
    cn(
      "rounded-full border px-3 py-1 text-xs",
      active ? "border-primary bg-primary-soft text-primary" : "text-muted-foreground hover:text-foreground",
    );

  let body: React.ReactNode = null;
  let rangeLabel = "";
  if (tab === "commercial") {
    const r = await commercialReport(db, ctx, query);
    rangeLabel = `${formatDay(r.range.from)} – ${formatDay(new Date(Date.parse(r.range.to) - 86_400_000).toISOString().slice(0, 10))}`;
    body = (
      <div className="grid gap-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi
            label="Leads nuevos"
            value={String(r.totals.leads)}
            hint={`${r.totals.open} siguen abiertos`}
          />
          <Kpi
            label="Contactados"
            value={pctText(r.totals.contactRate)}
            hint={`${r.totals.contacted} de ${r.totals.leads}`}
          />
          <Kpi label="Primera respuesta (mediana)" value={hoursText(r.totals.responseHours)} />
          <Kpi
            label="Conversión a cierre"
            value={pctText(r.totals.conversion)}
            hint={`${r.totals.won} ganados · ${r.totals.lost} perdidos`}
          />
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <Section title="Embudo" description="Leads del período según la etapa más avanzada que alcanzaron.">
            <HBars
              rows={r.funnel.map((f, i) => ({
                label: LEAD_STATUS_LABELS[f.stage as FunnelStage],
                value: f.count,
                note:
                  i > 0
                    ? pctText(r.funnel[0]?.count ? Math.round((f.count / r.funnel[0].count) * 100) : null)
                    : null,
              }))}
            />
          </Section>
          <Section
            title="Leads por mes"
            description="Últimos 12 meses, con los mismos filtros de sucursal y agente."
          >
            <MonthlyBars data={r.trend} label="Leads nuevos por mes" />
          </Section>
        </div>
        <Section title="Por origen" exportHref={exportHref("sources")}>
          <Table>
            <THead>
              <TR>
                <TH>Origen</TH>
                <TH className="text-right">Leads</TH>
                <TH className="text-right">Contactados</TH>
                <TH className="text-right">Ganados</TH>
                <TH className="text-right">Conversión</TH>
                <TH className="text-right">1.ª respuesta</TH>
              </TR>
            </THead>
            <TBody>
              {r.bySource.map((s) => (
                <TR key={s.source}>
                  <TD>{LEAD_SOURCE_LABELS[s.source as LeadSource] ?? s.source}</TD>
                  <TD className="text-right tabular">{s.leads}</TD>
                  <TD className="text-right tabular">{pctText(s.contactRate)}</TD>
                  <TD className="text-right tabular">{s.won}</TD>
                  <TD className="text-right tabular">{pctText(s.conversion)}</TD>
                  <TD className="text-right tabular">{hoursText(s.responseHours)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>
        <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
          <Section title="Por agente" exportHref={exportHref("agents")}>
            <Table>
              <THead>
                <TR>
                  <TH>Agente</TH>
                  <TH className="text-right">Leads</TH>
                  <TH className="text-right">Contactados</TH>
                  <TH className="text-right">Ganados</TH>
                  <TH className="text-right">Conversión</TH>
                  <TH className="text-right">1.ª respuesta</TH>
                </TR>
              </THead>
              <TBody>
                {r.byAgent.map((a) => (
                  <TR key={a.userId ?? "none"}>
                    <TD>{a.name}</TD>
                    <TD className="text-right tabular">{a.leads}</TD>
                    <TD className="text-right tabular">{pctText(a.contactRate)}</TD>
                    <TD className="text-right tabular">{a.won}</TD>
                    <TD className="text-right tabular">{pctText(a.conversion)}</TD>
                    <TD className="text-right tabular">{hoursText(a.responseHours)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Section>
          <Section title="Motivos de pérdida">
            {r.lostReasons.length ? (
              <HBars
                rows={r.lostReasons.map((x) => ({
                  label: LEAD_LOST_REASON_LABELS[x.reason as LeadLostReason] ?? x.reason,
                  value: x.count,
                }))}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Sin leads perdidos en el período.</p>
            )}
          </Section>
        </div>
      </div>
    );
  } else if (tab === "operations") {
    const r = await operationsReport(db, ctx, query);
    rangeLabel = `${formatDay(r.range.from)} – ${formatDay(new Date(Date.parse(r.range.to) - 86_400_000).toISOString().slice(0, 10))}`;
    body = (
      <div className="grid gap-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi
            label="Operaciones cerradas"
            value={String(r.totals.closed)}
            hint={`${r.totals.sales} ventas · ${r.totals.rentals} alquileres`}
          />
          <Kpi label="Volumen" value={both(r.totals.volume)} />
          <Kpi
            label="Honorarios"
            value={both({
              USD: r.totals.fees.pending.USD + r.totals.fees.collected.USD,
              UYU: r.totals.fees.pending.UYU + r.totals.fees.collected.UYU,
            })}
            hint={`Cobrado: ${both(r.totals.fees.collected)}`}
          />
          <Kpi
            label="Días para cerrar (mediana)"
            value={r.totals.daysToClose === null ? "—" : String(Math.round(r.totals.daysToClose))}
            hint={
              r.totals.daysOnMarket === null
                ? null
                : `${Math.round(r.totals.daysOnMarket)} días en el mercado`
            }
          />
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <Section title="Cierres por mes" description="Últimos 12 meses.">
            <MonthlyBars data={r.trend} label="Operaciones cerradas por mes" />
          </Section>
          <Section title="Operaciones caídas" description={`${r.totals.fallen} en el período`}>
            {r.fallenReasons.length ? (
              <HBars rows={r.fallenReasons.map((x) => ({ label: x.reason, value: x.count }))} />
            ) : (
              <p className="text-sm text-muted-foreground">Ninguna operación se cayó en el período.</p>
            )}
          </Section>
        </div>
        <Section
          title="Ranking por agente"
          description={`Montos en dólares (pesos convertidos a ${r.rate.toFixed(2).replace(".", ",")} por dólar).`}
          exportHref={exportHref("deal-agents")}
        >
          <Table>
            <THead>
              <TR>
                <TH>Agente</TH>
                <TH className="text-right">Cierres</TH>
                <TH className="text-right">Ventas</TH>
                <TH className="text-right">Alquileres</TH>
                <TH className="text-right">Volumen</TH>
                <TH className="text-right">Honorarios</TH>
              </TR>
            </THead>
            <TBody>
              {r.byAgent.length === 0 && (
                <TR>
                  <TD colSpan={6} className="text-muted-foreground">
                    Sin cierres en el período.
                  </TD>
                </TR>
              )}
              {r.byAgent.map((a) => (
                <TR key={a.userId}>
                  <TD>{a.name}</TD>
                  <TD className="text-right tabular">{a.deals}</TD>
                  <TD className="text-right tabular">{a.sales}</TD>
                  <TD className="text-right tabular">{a.rentals}</TD>
                  <TD className="text-right tabular">{usd(a.volumeUsd)}</TD>
                  <TD className="text-right tabular">{usd(a.feesUsd)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>
        {r.deals.length > 0 && (
          <Section title="Operaciones cerradas" exportHref={exportHref("deals")}>
            <Table>
              <THead>
                <TR>
                  <TH>Operación</TH>
                  <TH>Propiedad</TH>
                  <TH>Agente</TH>
                  <TH>Cierre</TH>
                  <TH className="text-right">Precio</TH>
                </TR>
              </THead>
              <TBody>
                {r.deals.map((d) => (
                  <TR key={d.id}>
                    <TD>
                      <Link href={`/commercial/deals/${d.id}`} className="font-mono text-xs hover:underline">
                        {d.code}
                      </Link>
                    </TD>
                    <TD className="font-mono text-xs">{d.propertyCode}</TD>
                    <TD>{d.agent}</TD>
                    <TD>{formatDay(d.closedAt)}</TD>
                    <TD className="text-right tabular">{price(d.priceMinor, d.currency)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Section>
        )}
      </div>
    );
  } else if (tab === "rentals") {
    const r = await rentalsReport(db, ctx, query);
    rangeLabel = `${formatDay(r.range.from)} – ${formatDay(new Date(Date.parse(r.range.to) - 86_400_000).toISOString().slice(0, 10))}`;
    const rate = [
      r.collectionRate.UYU !== null ? `${String(r.collectionRate.UYU).replace(".", ",")} % en pesos` : null,
      r.collectionRate.USD !== null ? `${String(r.collectionRate.USD).replace(".", ",")} % en dólares` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    body = (
      <div className="grid gap-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi
            label="Contratos vigentes"
            value={String(r.activeContracts)}
            hint={`${r.started} nuevos en el período · ${r.endingSoon} vencen en 90 días`}
          />
          <Kpi label="Facturado en el período" value={both(r.billed)} />
          <Kpi label="Cobrado" value={both(r.collected)} hint={rate || "Sin cuotas en el período"} />
          <Kpi label="Morosidad hoy" value={both(r.overdue)} hint={`${r.overdueCount} cuota(s) vencida(s)`} />
        </div>
        <Section title="Liquidaciones pagadas a propietarios" description="En el período.">
          <p className="text-sm">
            <span className="font-semibold">{r.settlements.count}</span> liquidación(es) ·{" "}
            {both({ USD: r.settlements.USD, UYU: r.settlements.UYU })}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            El detalle de cada cuota y liquidación está en{" "}
            <Link href="/rentals/charges" className="text-primary hover:underline">
              Cobros
            </Link>{" "}
            y{" "}
            <Link href="/rentals/settlements" className="text-primary hover:underline">
              Liquidaciones
            </Link>
            .
          </p>
        </Section>
      </div>
    );
  } else {
    const r = await inventoryReport(db, ctx, query);
    rangeLabel = "Foto de hoy (las bajas de precio son del período)";
    body = (
      <div className="grid gap-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi
            label="Propiedades activas"
            value={String(r.active)}
            hint="Disponibles, publicadas o en negociación"
          />
          <Kpi
            label="Antigüedad promedio"
            value={r.avgDaysOnMarket === null ? "—" : `${r.avgDaysOnMarket} días`}
            hint="Desde la publicación"
          />
          <Kpi
            label="Bajas de precio"
            value={String(r.priceDrops)}
            hint="Propiedades que bajaron el precio publicado en el período"
          />
          <Kpi
            label="Más de 90 días"
            value={String(r.stale.length)}
            hint="Disponibles o publicadas sin cerrar"
          />
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <Section title="Por estado">
            <HBars
              rows={r.byStatus.map((s) => ({
                label: PROPERTY_STATUS_LABELS[s.status as PropertyStatus],
                value: s.n,
              }))}
            />
          </Section>
          <Section title="Activas por tipo">
            {r.byType.length ? (
              <HBars
                rows={r.byType.map((s) => ({
                  label: PROPERTY_TYPE_LABELS[s.type as PropertyType],
                  value: s.n,
                }))}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Sin propiedades activas.</p>
            )}
          </Section>
        </div>
        <Section
          title="Propiedades estancadas"
          description="Más de 90 días en el mercado: revisar precio, fotos o exclusividad."
          exportHref={exportHref("stale")}
        >
          {r.stale.length ? (
            <Table>
              <THead>
                <TR>
                  <TH>Propiedad</TH>
                  <TH>Responsable</TH>
                  <TH className="text-right">Días</TH>
                </TR>
              </THead>
              <TBody>
                {r.stale.map((s) => (
                  <TR key={s.id}>
                    <TD>
                      <Link href={`/properties/${s.id}`} className="hover:underline">
                        <span className="font-mono text-xs">{s.code}</span> · {s.title}
                      </Link>
                    </TD>
                    <TD>{s.agent ?? "—"}</TD>
                    <TD className="text-right tabular">{s.days}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">Ninguna propiedad supera los 90 días.</p>
          )}
        </Section>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Reportes"
        description="Conversión, cierres, honorarios, cobranza e inventario. Cada número respeta tu alcance (equipo, sucursal u organización)."
      />
      <nav aria-label="Reportes" className="mb-4 flex gap-1 overflow-x-auto border-b">
        {REPORT_TABS.map((t) => (
          <Link
            key={t}
            href={qs({ tab: t })}
            aria-current={tab === t ? "page" : undefined}
            className={cn(
              "shrink-0 border-b-2 px-3 py-2 text-sm",
              tab === t
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {REPORT_TAB_LABELS[t]}
          </Link>
        ))}
      </nav>
      <div className="mb-5 grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {PERIODS.filter((x) => x !== "custom").map((x) => (
            <Link
              key={x}
              href={qs({ period: x, from: undefined, to: undefined })}
              className={chip(period === x)}
            >
              {PERIOD_LABELS[x]}
            </Link>
          ))}
          <span className="text-xs text-muted-foreground">· {rangeLabel}</span>
        </div>
        <form className="flex flex-wrap items-end gap-2" method="get">
          <input type="hidden" name="tab" value={tab} />
          <input type="hidden" name="period" value="custom" />
          <label className="grid gap-1 text-xs">
            Desde
            <Input type="date" name="from" defaultValue={p.from ?? ""} className="h-8 w-40" />
          </label>
          <label className="grid gap-1 text-xs">
            Hasta
            <Input type="date" name="to" defaultValue={p.to ?? ""} className="h-8 w-40" />
          </label>
          {filters.branches.length > 1 && (
            <label className="grid gap-1 text-xs">
              Sucursal
              <Select name="branch" defaultValue={p.branch ?? ""} className="h-8 w-44">
                <option value="">Todas</option>
                {filters.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </label>
          )}
          <label className="grid gap-1 text-xs">
            Agente
            <Select name="user" defaultValue={p.user ?? ""} className="h-8 w-44">
              <option value="">Todos</option>
              {filters.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </label>
          <Button type="submit" size="sm" variant="secondary">
            Aplicar
          </Button>
          {(p.from || p.to || p.branch || p.user) && (
            <Link href={`?tab=${tab}`} className="pb-1.5 text-xs text-primary hover:underline">
              Limpiar
            </Link>
          )}
        </form>
      </div>
      {body}
    </>
  );
}
