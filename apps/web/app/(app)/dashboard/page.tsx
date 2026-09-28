import { getOrganizationSummary, hasPermission, leadStats, listAuditLogs } from "@crm/core";
import { LEAD_STATUS_LABELS, type LeadStatus } from "@crm/shared/crm";
import { getDb } from "@crm/db";
import { Activity, BellRing, CheckCircle2, Circle, Inbox, Target, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { auditActionLabel } from "@/lib/audit-labels";
import { requirePagePermission } from "@/lib/session";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };

/** Hitos del roadmap que alimentan los KPIs del dashboard ejecutivo (Fase 13). */
const ROADMAP = [
  { phase: 1, title: "Fundaciones", detail: "Usuarios, roles, sucursales, equipos, auditoría", done: true },
  { phase: 2, title: "CRM", detail: "Contactos, leads, propietarios, búsqueda global", done: true },
  { phase: 3, title: "Propiedades", detail: "Inventario, multimedia, captaciones, tasaciones", done: false },
  { phase: 4, title: "Matching", detail: "Compatibilidad cliente ↔ propiedad", done: false },
  { phase: 5, title: "Agenda y visitas", detail: "Calendario, tareas, feedback", done: false },
  { phase: 6, title: "Ofertas y reservas", detail: "Negociación con historial inmutable", done: false },
];

export default async function DashboardPage() {
  const { ctx, user } = await requirePagePermission("dashboard.read");
  const db = getDb();
  const summary = await getOrganizationSummary(db, ctx);
  const canAudit = hasPermission(ctx, "audit.read");
  const recent = canAudit ? await listAuditLogs(db, ctx, { page: 1, pageSize: 6 }) : null;

  const leads = await leadStats(db, ctx);
  const FUNNEL: LeadStatus[] = ["new", "contacted", "qualified", "visit", "offer", "reservation", "won"];
  const funnel = leads ? FUNNEL.map((st) => ({ status: st, n: leads.byStatus[st] ?? 0 })) : [];
  const openLeads = funnel.filter((f) => f.status !== "won").reduce((a, f) => a + f.n, 0);
  const maxStage = Math.max(1, ...funnel.map((f) => f.n));

  const stats = [
    ...(leads
      ? [
          {
            label: "Leads nuevos",
            value: leads.newLast30Days,
            sub: "últimos 30 días",
            icon: Inbox,
            href: "/crm/leads?status=new",
          },
          {
            label: "Sin atender",
            value: leads.unattended,
            sub: leads.unattended ? "nadie registró contacto todavía" : "todos atendidos",
            icon: BellRing,
            href: "/crm/leads?status=new&unattended=1",
            alert: leads.unattended > 0,
          },
          {
            label: "Leads abiertos",
            value: openLeads,
            sub: "en el embudo",
            icon: Target,
            href: "/crm/leads",
          },
        ]
      : []),
    ...(hasPermission(ctx, "users.read")
      ? [
          {
            label: "Usuarios activos",
            value: summary.active,
            sub: `${summary.branches} sucursales · ${summary.teams} equipos`,
            icon: Users,
            href: "/admin/users",
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title={`Hola, ${user.name.split(" ")[0]}`}
        description="Leads según tu alcance. Propiedades, visitas, comisiones y morosidad se suman a medida que se habilitan sus módulos."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map(({ label, value, sub, icon: Icon, href, ...rest }) => (
          <Link key={label} href={href} className="group">
            <Card
              className={`p-4 transition-colors group-hover:border-border-strong ${"alert" in rest && rest.alert ? "border-warning/60 bg-warning-soft/40" : ""}`}
            >
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                {label}
                <Icon className="size-4" aria-hidden />
              </div>
              <p className="mt-2 text-2xl font-semibold tabular">{value}</p>
              <p className="text-xs text-muted-foreground">{sub}</p>
            </Card>
          </Link>
        ))}
      </div>

      {leads && (
        <Card className="mt-6">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Embudo comercial</h2>
            <Link href="/crm/leads" className="text-xs text-primary hover:underline">
              Ver leads
            </Link>
          </div>
          <ol className="grid gap-2 p-4">
            {funnel.map((f) => (
              <li key={f.status}>
                <Link
                  href={`/crm/leads?status=${f.status}`}
                  className="grid grid-cols-[6.5rem_1fr_2.5rem] items-center gap-3 text-sm hover:opacity-80"
                >
                  <span className="text-muted-foreground">{LEAD_STATUS_LABELS[f.status]}</span>
                  <span className="h-2.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden>
                    <span
                      className="block h-full rounded-full bg-primary"
                      style={{ width: `${(f.n / maxStage) * 100}%` }}
                    />
                  </span>
                  <span className="text-right font-medium tabular">{f.n}</span>
                </Link>
              </li>
            ))}
          </ol>
          <p className="border-t px-4 py-2 text-xs text-muted-foreground">
            Cantidad actual de leads en cada etapa
            {(leads.byStatus.lost ?? 0) > 0 ? ` · ${leads.byStatus.lost} perdidos` : ""}. Las tasas de
            conversión llegan con los reportes (Fase 13).
          </p>
        </Card>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Actividad reciente</h2>
            {canAudit && (
              <Link href="/admin/audit" className="text-xs text-primary hover:underline">
                Ver auditoría
              </Link>
            )}
          </div>
          {!recent || recent.items.length === 0 ? (
            <EmptyState
              icon={Activity}
              title="Sin actividad para mostrar"
              description={
                canAudit
                  ? "Las acciones sobre usuarios, roles y configuración aparecen aquí."
                  : "Tu rol no incluye la vista de auditoría."
              }
            />
          ) : (
            <ul className="divide-y">
              {recent.items.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{auditActionLabel(item.action)}</p>
                    <p className="truncate text-xs text-muted-foreground">{item.actorName ?? "Sistema"}</p>
                  </div>
                  <time className="shrink-0 text-xs text-muted-foreground tabular">
                    {formatDateTime(item.createdAt)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Estado de implementación</h2>
          </div>
          <ol className="divide-y">
            {ROADMAP.map((step) => (
              <li key={step.phase} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                {step.done ? (
                  <CheckCircle2 className="mt-0.5 size-4 text-success" aria-label="Completada" />
                ) : (
                  <Circle className="mt-0.5 size-4 text-muted-foreground" aria-label="Pendiente" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{step.title}</p>
                  <p className="text-xs text-muted-foreground">{step.detail}</p>
                </div>
                <Badge tone={step.done ? "success" : "outline"}>Fase {step.phase}</Badge>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </>
  );
}
