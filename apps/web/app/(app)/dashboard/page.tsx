import {
  expiringExclusivities,
  hasPermission,
  leadStats,
  listAcquisitions,
  listProperties,
  propertyStats,
} from "@crm/core";
import { getDb } from "@crm/db";
import {
  ACQUISITION_STAGE_LABELS,
  OPEN_ACQUISITION_STAGES,
  PROPERTY_OPERATION_LABELS,
  PROPERTY_TYPE_LABELS,
} from "@crm/shared";
import {
  Bath,
  BedDouble,
  BellRing,
  Building2,
  CalendarClock,
  CalendarDays,
  Calculator,
  ChevronRight,
  Home,
  ImageOff,
  Inbox,
  Ruler,
  Target,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { daysUntil, formatDay, price } from "@/components/properties/format";
import { PrivateImage } from "@/components/properties/private-image";
import { Badge, Card, EmptyState } from "@/components/ui/misc";
import { requirePagePermission } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };

const TZ = "America/Montevideo";

function greeting(now: Date): string {
  const hour = Number(
    new Intl.DateTimeFormat("es-UY", { hour: "numeric", hour12: false, timeZone: TZ }).format(now),
  );
  if (hour >= 5 && hour < 12) return "Buenos días";
  if (hour >= 12 && hour < 20) return "Buenas tardes";
  return "Buenas noches";
}

function longDate(now: Date): string {
  return new Intl.DateTimeFormat("es-UY", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: TZ,
  }).format(now);
}

function area(v: string | null): string {
  if (!v) return "—";
  return `${Number(v).toLocaleString("es-UY", { maximumFractionDigits: 0 })} m²`;
}

function SectionTitle({
  children,
  href,
  linkLabel,
}: {
  children: React.ReactNode;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="border-l-2 border-primary pl-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        {children}
      </h2>
      {href && (
        <Link href={href} className="inline-flex items-center text-xs text-primary hover:underline">
          {linkLabel ?? "Ver todo"}
          <ChevronRight className="size-3.5" aria-hidden />
        </Link>
      )}
    </div>
  );
}

export default async function DashboardPage() {
  const { ctx, user } = await requirePagePermission("dashboard.read");
  const db = getDb();
  const canProps = hasPermission(ctx, "property.read");
  const canAcq = hasPermission(ctx, "acquisition.read");

  const [leads, props, expiring, latest, acq] = await Promise.all([
    leadStats(db, ctx),
    propertyStats(db, ctx),
    expiringExclusivities(db, ctx, 30),
    canProps ? listProperties(db, ctx, { status: "active", page: 1, pageSize: 6 }) : null,
    canAcq ? listAcquisitions(db, ctx, { stage: "open", page: 1, pageSize: 5 }) : null,
  ]);

  const activeProps = props
    ? (props.available ?? 0) + (props.published ?? 0) + (props.negotiating ?? 0) + (props.reserved ?? 0)
    : 0;
  const openAcq = acq ? OPEN_ACQUISITION_STAGES.reduce((a, s) => a + (acq.byStage[s] ?? 0), 0) : 0;
  const openLeads = leads
    ? Object.entries(leads.byStatus)
        .filter(([s]) => s !== "won" && s !== "lost")
        .reduce((a, [, n]) => a + (n ?? 0), 0)
    : 0;

  const now = new Date();
  const firstName = user.name.split(" ")[0];

  const heroStats = [
    canAcq && { value: openAcq, label: "captaciones abiertas" },
    canProps && { value: activeProps, label: "propiedades activas" },
    leads && { value: leads.unattended, label: "leads sin atender" },
  ].filter(Boolean) as { value: number; label: string }[];

  const kpis: {
    label: string;
    value: number;
    sub: string;
    icon: LucideIcon;
    href: string;
    alert?: boolean;
  }[] = [
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
            sub: leads.unattended ? "nadie registró contacto" : "todos atendidos",
            icon: BellRing,
            href: "/crm/leads?status=new&unattended=1",
            alert: leads.unattended > 0,
          },
          {
            label: "Clientes en seguimiento",
            value: openLeads,
            sub: "en el embudo",
            icon: Target,
            href: "/crm/leads",
          },
        ]
      : []),
    ...(props
      ? [
          {
            label: "Propiedades activas",
            value: activeProps,
            sub: `${props.published ?? 0} publicadas · ${props.draft ?? 0} en borrador`,
            icon: Building2,
            href: "/properties",
          },
        ]
      : []),
  ];

  const quick: { label: string; href: string; icon: LucideIcon; perm: boolean }[] = [
    { label: "Clientes", href: "/crm/clients", icon: Users, perm: hasPermission(ctx, "lead.read") },
    { label: "Propiedades", href: "/properties", icon: Building2, perm: canProps },
    { label: "Captaciones", href: "/properties/acquisitions", icon: Home, perm: canAcq },
    {
      label: "Tasaciones",
      href: "/properties/valuations",
      icon: Calculator,
      perm: hasPermission(ctx, "valuation.read"),
    },
    { label: "Agenda", href: "/agenda", icon: CalendarDays, perm: hasPermission(ctx, "calendar.read") },
    {
      label: "Comisiones",
      href: "/finance/commissions",
      icon: Wallet,
      perm: hasPermission(ctx, "commission.read"),
    },
  ];

  return (
    <div className="space-y-8">
      {/* Saludo */}
      <section className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary-soft via-surface to-surface p-6 sm:p-8">
        <span className="mb-4 block h-0.5 w-8 rounded bg-primary" aria-hidden />
        <p className="text-xs font-semibold tracking-wider text-primary uppercase">{longDate(now)}</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
          {greeting(now)},
          <br />
          <span className="text-primary">{firstName}</span>
        </h1>
        {heroStats.length > 0 && (
          <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-3">
            {heroStats.map((s) => (
              <div key={s.label}>
                <dt className="sr-only">{s.label}</dt>
                <dd className="text-2xl font-bold tabular">{s.value}</dd>
                <dd className="text-xs text-muted-foreground">{s.label}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      {/* Agenda de hoy (Fase 5) */}
      <section>
        <SectionTitle>Agenda de hoy</SectionTitle>
        <Card className="flex items-center gap-3 p-4 text-sm">
          <CalendarDays className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-muted-foreground">
            Visitas, reuniones, llamadas y recordatorios del día, y las visitas que ya pasaron sin marcar
            resultado, se muestran acá cuando se habilite la agenda.
          </p>
          <Badge tone="outline" className="ml-auto">
            Fase 5
          </Badge>
        </Card>
      </section>

      {/* KPIs */}
      {kpis.length > 0 && (
        <section>
          <SectionTitle>Resumen</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {kpis.map(({ label, value, sub, icon: Icon, href, alert }) => (
              <Link key={label} href={href} className="group">
                <Card
                  className={cn(
                    "h-full rounded-xl p-4 transition-colors group-hover:border-border-strong",
                    alert && "border-warning/60 bg-warning-soft/40",
                  )}
                >
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    {label}
                    <Icon className="size-4" aria-hidden />
                  </div>
                  <p className="mt-2 text-3xl font-bold tabular">{value}</p>
                  <p className="text-xs text-muted-foreground">{sub}</p>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Pipeline de captaciones */}
        {acq && (
          <section>
            <SectionTitle href="/properties/acquisitions" linkLabel="Ver captaciones">
              Pipeline de captaciones
            </SectionTitle>
            <Card className="rounded-xl p-4">
              <div className="grid grid-cols-5 gap-2">
                {OPEN_ACQUISITION_STAGES.map((s) => (
                  <Link
                    key={s}
                    href={`/properties/acquisitions?stage=${s}`}
                    className="rounded-lg bg-surface-muted p-2 text-center hover:bg-sidebar-active"
                  >
                    <p className="text-xl font-bold tabular">{acq.byStage[s] ?? 0}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {ACQUISITION_STAGE_LABELS[s]}
                    </p>
                  </Link>
                ))}
              </div>
              {acq.items.length > 0 && (
                <ul className="mt-4 divide-y text-sm">
                  {acq.items.map((a) => (
                    <li key={a.id}>
                      <Link
                        href={`/properties/acquisitions/${a.id}`}
                        className="flex items-center justify-between gap-3 py-2 hover:opacity-80"
                      >
                        <span className="min-w-0 truncate">
                          <span className="font-mono text-xs text-muted-foreground">{a.code}</span>{" "}
                          {a.zone || a.address || "Sin dirección"}
                        </span>
                        <Badge>{ACQUISITION_STAGE_LABELS[a.stage]}</Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>
        )}

        {/* Exclusividades por vencer */}
        {canAcq && (
          <section>
            <SectionTitle>Exclusividades por vencer</SectionTitle>
            <Card className="rounded-xl">
              {expiring.length === 0 ? (
                <EmptyState
                  icon={CalendarClock}
                  title="Todo al día"
                  description="Ninguna exclusividad vence en los próximos 30 días."
                />
              ) : (
                <ul className="divide-y text-sm">
                  {expiring.map((e) => {
                    const d = e.exclusiveUntil ? daysUntil(e.exclusiveUntil) : null;
                    return (
                      <li key={e.id}>
                        <Link
                          href={`/properties/acquisitions/${e.id}`}
                          className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-surface-muted"
                        >
                          <span className="font-mono text-xs">{e.code}</span>
                          <span className="text-xs text-muted-foreground">{formatDay(e.exclusiveUntil)}</span>
                          <Badge tone={d !== null && d <= 7 ? "danger" : "warning"}>
                            {d === 0 ? "vence hoy" : `${d} días`}
                          </Badge>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </section>
        )}
      </div>

      {/* Accesos rápidos */}
      <section>
        <SectionTitle>Acceso rápido</SectionTitle>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {quick
            .filter((q) => q.perm)
            .map(({ label, href, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="flex flex-col items-center gap-2 rounded-xl border bg-surface p-4 text-center text-xs font-medium hover:border-primary/60"
              >
                <Icon className="size-5 text-primary" aria-hidden />
                {label}
              </Link>
            ))}
        </div>
      </section>

      {/* Nuevos ingresos */}
      {latest && (
        <section>
          <SectionTitle href="/properties" linkLabel="Ver propiedades">
            Nuevos ingresos
          </SectionTitle>
          {latest.items.length === 0 ? (
            <Card>
              <EmptyState icon={Building2} title="Todavía no hay propiedades activas" />
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {latest.items.map((p) => (
                <Link key={p.id} href={`/properties/${p.id}`} className="group">
                  <Card className="h-full overflow-hidden rounded-xl transition-colors group-hover:border-border-strong">
                    <div className="relative aspect-[16/10] bg-surface-muted">
                      {p.coverMediaId ? (
                        <PrivateImage mediaId={p.coverMediaId} alt={p.displayTitle} />
                      ) : (
                        <div className="flex h-full items-center justify-center text-muted-foreground">
                          <ImageOff className="size-6" aria-hidden />
                        </div>
                      )}
                      <div className="absolute top-2 left-2 flex gap-1">
                        {p.operations.map((op) => (
                          <Badge key={op} tone="primary" className="bg-surface/90 uppercase">
                            {PROPERTY_OPERATION_LABELS[op]}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <div className="p-4">
                      <p className="text-xs text-muted-foreground">{PROPERTY_TYPE_LABELS[p.type]}</p>
                      <p className="mt-0.5 line-clamp-2 font-semibold">{p.displayTitle}</p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {[p.neighborhoodName, p.localityName].filter(Boolean).join(", ") || "—"}
                      </p>
                      {p.prices[0] && (
                        <p className="mt-2 text-lg font-bold text-primary">
                          {price(p.prices[0].listMinor, p.prices[0].currency)}
                        </p>
                      )}
                      <div className="mt-3 flex items-center gap-4 border-t pt-3 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <BedDouble className="size-3.5" aria-label="Dormitorios" />
                          {p.bedrooms ?? "—"}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Bath className="size-3.5" aria-label="Baños" />
                          {p.bathrooms ?? "—"}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Ruler className="size-3.5" aria-label="Superficie" />
                          {area(p.builtArea ?? p.totalArea)}
                        </span>
                        <span className="ml-auto font-mono">{p.code}</span>
                      </div>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
