import { agendaOverview, hasPermission, listAgendaAssignees, listEvents } from "@crm/core";
import { getDb } from "@crm/db";
import { EVENT_TYPE_LABELS, EVENT_TYPES, type EventType } from "@crm/shared/agenda";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AgendaBoard, type AgendaView } from "@/components/agenda/agenda-board";
import { toView } from "@/components/agenda/shared";
import { Button } from "@/components/ui/button";
import { Badge, PageHeader } from "@/components/ui/misc";
import { requirePagePermission } from "@/lib/session";
import {
  DEFAULT_TZ,
  addDays,
  capitalizeFirst,
  formatDayLong,
  formatMonthYear,
  isYmd,
  weekdayMon0,
  ymdInTz,
  zonedToDate,
} from "@/lib/tz";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Agenda" };

const VIEWS: { key: AgendaView; label: string }[] = [
  { key: "month", label: "Mes" },
  { key: "week", label: "Semana" },
  { key: "day", label: "Día" },
  { key: "list", label: "Lista" },
];

function range(
  view: AgendaView,
  anchor: string,
): { start: string; days: number; prev: string; next: string } {
  if (view === "month") {
    const first = `${anchor.slice(0, 7)}-01`;
    const start = addDays(first, -weekdayMon0(first));
    const [y, m] = anchor.split("-").map(Number);
    const prev = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 2, 1)).toISOString().slice(0, 10);
    const next = new Date(Date.UTC(y ?? 1970, m ?? 1, 1)).toISOString().slice(0, 10);
    return { start, days: 42, prev, next };
  }
  if (view === "week") {
    const start = addDays(anchor, -weekdayMon0(anchor));
    return { start, days: 7, prev: addDays(anchor, -7), next: addDays(anchor, 7) };
  }
  if (view === "day") return { start: anchor, days: 1, prev: addDays(anchor, -1), next: addDays(anchor, 1) };
  return { start: anchor, days: 30, prev: addDays(anchor, -30), next: addDays(anchor, 30) };
}

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { ctx } = await requirePagePermission("calendar.read");
  const params = await searchParams;
  const tz = ctx.organization.timezone || DEFAULT_TZ;
  const view: AgendaView = VIEWS.some((v) => v.key === params.view) ? (params.view as AgendaView) : "month";
  const today = ymdInTz(new Date(), tz);
  const anchor = isYmd(params.date) ? params.date : today;
  const type = (EVENT_TYPES as readonly string[]).includes(params.type ?? "")
    ? (params.type as EventType)
    : undefined;
  const mine = params.mine === "1";
  const r = range(view, anchor);

  const db = getDb();
  const canCreate = hasPermission(ctx, "visit.manage") || hasPermission(ctx, "task.manage");
  const [events, assignees, overview] = await Promise.all([
    listEvents(db, ctx, {
      from: zonedToDate(r.start, "00:00", tz).toISOString(),
      to: zonedToDate(addDays(r.start, r.days), "00:00", tz).toISOString(),
      type,
      assignedUserId: mine ? ctx.userId : undefined,
    }),
    canCreate ? listAgendaAssignees(db, ctx) : Promise.resolve(null),
    agendaOverview(db, ctx),
  ]);

  const link = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ view, date: anchor, type, mine: mine ? "1" : undefined, ...patch }))
      if (v) next.set(k, v);
    return `/agenda?${next.toString()}`;
  };

  const title =
    view === "month"
      ? formatMonthYear(anchor)
      : view === "week"
        ? `Semana del ${formatDayLong(r.start)}`
        : view === "day"
          ? formatDayLong(anchor)
          : `Desde el ${formatDayLong(anchor)}`;

  return (
    <>
      <PageHeader title="Agenda" description="Visitas, reuniones, llamadas y recordatorios." />

      {overview && overview.pendingClose.length > 0 && (
        <Link
          href={link({ view: "list", date: addDays(today, -29) })}
          className="mb-4 flex items-center gap-2 rounded-lg border border-warning/60 bg-warning-soft/40 px-4 py-3 text-sm hover:bg-warning-soft/60"
        >
          <Badge tone="warning">{overview.pendingClose.length}</Badge>
          {overview.pendingClose.length === 1
            ? "evento ya pasó y nadie marcó cómo salió."
            : "eventos ya pasaron y nadie marcó cómo salieron."}
          <span className="ml-auto text-primary">Revisar</span>
        </Link>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Button variant="secondary" size="icon-sm" asChild>
            <Link href={link({ date: r.prev })} aria-label="Anterior">
              <ChevronLeft />
            </Link>
          </Button>
          <Button variant="secondary" size="sm" asChild>
            <Link href={link({ date: today })}>Hoy</Link>
          </Button>
          <Button variant="secondary" size="icon-sm" asChild>
            <Link href={link({ date: r.next })} aria-label="Siguiente">
              <ChevronRight />
            </Link>
          </Button>
        </div>
        <h2 className="text-lg font-semibold">{capitalizeFirst(title)}</h2>
        <nav aria-label="Vista" className="ml-auto flex rounded-md border p-0.5 text-sm">
          {VIEWS.map((v) => (
            <Link
              key={v.key}
              href={link({ view: v.key })}
              aria-current={view === v.key ? "page" : undefined}
              className={cn(
                "rounded px-3 py-1",
                view === v.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-surface-muted",
              )}
            >
              {v.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5 text-xs">
        <Link
          href={link({ type: undefined })}
          className={cn(
            "rounded-full border px-3 py-1",
            !type ? "border-primary bg-primary-soft text-primary" : "text-muted-foreground",
          )}
        >
          Todos
        </Link>
        {EVENT_TYPES.map((t) => (
          <Link
            key={t}
            href={link({ type: t })}
            className={cn(
              "rounded-full border px-3 py-1",
              type === t
                ? "border-primary bg-primary-soft text-primary"
                : "text-muted-foreground hover:bg-surface-muted",
            )}
          >
            {EVENT_TYPE_LABELS[t]}
          </Link>
        ))}
        <Link
          href={link({ mine: mine ? undefined : "1" })}
          className={cn(
            "ml-auto rounded-full border px-3 py-1",
            mine
              ? "border-primary bg-primary-soft text-primary"
              : "text-muted-foreground hover:bg-surface-muted",
          )}
        >
          Solo lo mío
        </Link>
      </div>

      <AgendaBoard
        events={events.map(toView)}
        view={view}
        anchor={anchor}
        rangeStart={r.start}
        days={r.days}
        tz={tz}
        assignees={assignees}
        canCreate={canCreate}
        defaultType={type}
      />
    </>
  );
}
