import { getOrganizationSummary, hasPermission, listAuditLogs } from "@crm/core";
import { getDb } from "@crm/db";
import { Activity, Building2, CheckCircle2, Circle, ShieldCheck, Users, UsersRound } from "lucide-react";
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
  { phase: 2, title: "CRM", detail: "Contactos, leads, propietarios, búsqueda global", done: false },
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

  const stats = [
    {
      label: "Usuarios activos",
      value: summary.active,
      sub: `${summary.members} en total`,
      icon: Users,
      href: "/admin/users",
    },
    {
      label: "Sucursales",
      value: summary.branches,
      sub: "activas",
      icon: Building2,
      href: "/admin/branches",
    },
    { label: "Equipos", value: summary.teams, sub: "activos", icon: UsersRound, href: "/admin/teams" },
    {
      label: "Roles",
      value: summary.roles,
      sub: "de sistema y propios",
      icon: ShieldCheck,
      href: "/admin/roles",
    },
  ];

  return (
    <>
      <PageHeader
        title={`Hola, ${user.name.split(" ")[0]}`}
        description="Los indicadores comerciales (propiedades, leads, visitas, comisiones, morosidad) aparecen aquí a medida que se habilitan sus módulos."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map(({ label, value, sub, icon: Icon, href }) => (
          <Link key={label} href={href} className="group">
            <Card className="p-4 transition-colors group-hover:border-border-strong">
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
