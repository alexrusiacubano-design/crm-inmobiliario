import { daysBetween } from "@crm/shared/offers";
import {
  agendaOverview,
  expiringExclusivities,
  hasPermission,
  leadStats,
  listAcquisitions,
  listDeals,
  listProperties,
  propertyStats,
  upcomingContactDates,
  myNewMatches,
  expiringReservations,
  pendingOffersCount,
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
  Gavel,
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
import { EventListCard } from "@/components/agenda/event-list-card";
import { toView } from "@/components/agenda/shared";
import { daysUntil, formatDay, price } from "@/components/properties/format";
import { ymdInTz } from "@/lib/tz";
import { PrivateImage } from "@/components/properties/private-image";
import { Badge, Card, EmptyState } from "@/components/ui/misc";
import { requirePagePermission } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };

const TZ = "America/Montevideo";

function greeting(now: Date, tz: string): string {
  const hour = Number(
    new Intl.DateTimeFormat("es-UY", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(now),
  );
  if (hour >= 5 && hour < 12) return "Buenos días";
  if (hour >= 12 && hour < 20) return "Buenas tardes";
  return "Buenas noches";
}

function longDate(now: Date, tz: string): string {
  return new Intl.DateTimeFormat("es-UY", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: tz,
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

  const tzEarly = ctx.organization.timezone || TZ;
  const [leads, props, expiring, latest, acq, agenda, dates, deals, matches, reservationsDue, offersDue] =
    await Promise.all([
      leadStats(db, ctx),
      propertyStats(db, ctx),
      expiringExclusivities(db, ctx, 30),
      canProps ? listProperties(db, ctx, { status: "active", page: 1, pageSize: 6 }) : null,
      canAcq ? listAcquisitions(db, ctx, { stage: "open", page: 1, pageSize: 5 }) : null,
      agendaOverview(db, ctx),
      upcomingContactDates(db, ctx, ymdInTz(new Date(), tzEarly), 14),
      hasPermission(ctx, "deal.read") ? listDeals(db, ctx, { status: "open", pageSize: 5 }) : null,
      myNewMatches(db, ctx, 5),
      expiringReservations(db, ctx, ymdInTz(new Date(), tzEarly), 7),
      pendingOffersCount(db, ctx, ymdInTz(new Date(), tzEarly)),
    ]);
  const tz = ctx.organization.timezone || TZ;

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
    agenda && { value: agenda.today.filter((e) => e.status === "scheduled").length, label: "en agenda hoy" },
    agenda && { value: agenda.pendingClose.length, label: "sin cerrar" },
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
    ...(deals
      ? [
          {
            label: "Operaciones en curso",
            value: deals.total,
            sub: deals.total ? "de la negociación a la firma" : "ninguna abierta",
            icon: Gavel,
            href: "/commercial/deals",
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
        <p className="text-xs font-semibold tracking-wider text-primary uppercase">{longDate(now, tz)}</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
          {greeting(now, tz)},
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

      {/* Agenda de hoy y visitas sin cerrar */}
      {agenda && (
        <div className="grid gap-8 lg:grid-cols-2">
          <section>
            <SectionTitle href="/agenda?view=day" linkLabel="Ver agenda">
              Agenda de hoy
            </SectionTitle>
            <Card className="rounded-xl">
              {agenda.today.length === 0 ? (
                <EmptyState
                  icon={CalendarDays}
                  title="Nada agendado para hoy"
                  description={
                    agenda.upcoming7Days
                      ? `Tenés ${agenda.upcoming7Days} ${agenda.upcoming7Days === 1 ? "evento" : "eventos"} en los próximos 7 días.`
                      : "Agendá visitas y llamadas desde la agenda o la ficha del cliente."
                  }
                />
              ) : (
                <EventListCard events={agenda.today.map(toView)} tz={tz} />
              )}
            </Card>
          </section>
          <section>
            <SectionTitle href="/agenda?view=list" linkLabel="Ir a la agenda">
              Sin cerrar
            </SectionTitle>
            <Card className={cn("rounded-xl", agenda.pendingClose.length > 0 && "border-warning/60")}>
              {agenda.pendingClose.length === 0 ? (
                <EmptyState
                  icon={CalendarClock}
                  title="Todo al día"
                  description="No hay visitas pasadas sin resultado."
                />
              ) : (
                <>
                  <p className="border-b px-4 py-2 text-xs text-muted-foreground">
                    Ya pasaron y nadie marcó cómo salieron. Tocá una para cerrarla.
                  </p>
                  <EventListCard
                    events={agenda.pendingClose.slice(0, 6).map(toView)}
                    tz={tz}
                    showDate
                    closeFirst
                  />
                </>
              )}
            </Card>
          </section>
        </div>
      )}

      {dates.length > 0 && (
        <section>
          <SectionTitle>Fechas importantes · próximos 14 días</SectionTitle>
          <Card className="rounded-xl">
            <ul className="divide-y text-sm">
              {dates.map((d) => (
                <li key={d.id}>
                  <Link
                    href={`/crm/contacts/${d.contactId}`}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-surface-muted"
                  >
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{d.contactName}</span> · {d.label}
                    </span>
                    <Badge tone={d.next && d.next.days <= 2 ? "warning" : "outline"}>
                      {d.next?.days === 0 ? "hoy" : d.next?.days === 1 ? "mañana" : `en ${d.next?.days} días`}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      {(reservationsDue.length > 0 || (offersDue && offersDue.pending > 0)) && (
        <section>
          <SectionTitle>Negociaciones que requieren atención</SectionTitle>
          <Card className="rounded-xl">
            <ul className="divide-y text-sm">
              {offersDue && offersDue.pending > 0 && (
                <li>
                  <Link
                    href="/commercial/offers"
                    className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-surface-muted"
                  >
                    <span>
                      <span className="font-medium">{offersDue.pending}</span> oferta(s) sin responder
                    </span>
                    {offersDue.expired > 0 && <Badge tone="danger">{offersDue.expired} vencida(s)</Badge>}
                  </Link>
                </li>
              )}
              {reservationsDue.map((r) => {
                const days = daysBetween(ymdInTz(new Date(), tz), r.expiresAt);
                return (
                  <li key={r.id}>
                    <Link
                      href={`/commercial/deals/${r.dealId}`}
                      className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-surface-muted"
                    >
                      <span className="min-w-0 truncate">
                        Reserva de <span className="font-medium">{r.clientName}</span>{" "}
                        <span className="font-mono text-xs text-muted-foreground">{r.dealCode}</span>
                      </span>
                      <Badge tone={days < 0 ? "danger" : "warning"}>
                        {days < 0 ? "vencida" : days === 0 ? "vence hoy" : `vence en ${days} días`}
                      </Badge>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        </section>
      )}

      {matches && matches.total > 0 && (
        <section>
          <SectionTitle>
            Propiedades para ofrecer · {matches.total}
            {matches.lastWeek > 0 ? ` (${matches.lastWeek} nuevas esta semana)` : ""}
          </SectionTitle>
          <Card className="rounded-xl">
            <ul className="divide-y text-sm">
              {matches.items.map((m) => (
                <li key={m.id}>
                  <Link
                    href={`/crm/leads/${m.leadId}`}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-surface-muted"
                  >
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{m.contactName}</span> ← {m.displayTitle}{" "}
                      <span className="font-mono text-xs text-muted-foreground">{m.code}</span>
                    </span>
                    <Badge tone={m.score >= 90 ? "success" : "primary"}>{m.score} %</Badge>
                  </Link>
                </li>
              ))}
            </ul>
            <Link
              href="/commercial/matching?mine=1"
              className="block border-t px-4 py-2 text-xs text-primary hover:underline"
            >
              Ver todo el matching
            </Link>
          </Card>
        </section>
      )}

      {/* KPIs */}
      {kpis.length > 0 && (
        <section>
          <SectionTitle>Resumen</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
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
