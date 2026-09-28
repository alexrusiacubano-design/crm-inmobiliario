"use client";

import { CalendarX, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { EVENT_TYPE_LABELS, type EventType } from "@crm/shared/agenda";
import { Button } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/misc";
import { addDays, capitalizeFirst, formatDayLong, hmInTz, ymdInTz } from "@/lib/tz";
import { cn } from "@/lib/utils";
import { EventDetailDialog } from "./event-detail-dialog";
import { EventFormDialog, type EventFormDefaults } from "./event-form-dialog";
import { TYPE_DOT, TYPE_TONE, type AgendaEventView } from "./shared";

export type AgendaView = "month" | "week" | "day" | "list";

const WEEKDAYS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

function EventChip({
  e,
  tz,
  onOpen,
  compact,
}: {
  e: AgendaEventView;
  tz: string;
  onOpen: () => void;
  compact?: boolean;
}) {
  const closed = e.status !== "scheduled";
  const overdue = !closed && (e.endsAt ?? e.startsAt).getTime() < Date.now();
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${EVENT_TYPE_LABELS[e.type]} · ${e.title}`}
      className={cn(
        "flex w-full min-w-0 items-center gap-1.5 rounded border px-1.5 text-left text-xs",
        compact ? "py-0.5" : "py-1.5",
        TYPE_TONE[e.type],
        closed && "opacity-55 line-through decoration-1",
        overdue && "ring-1 ring-warning",
      )}
    >
      {!e.allDay && <span className="shrink-0 font-medium tabular">{hmInTz(e.startsAt, tz)}</span>}
      <span className="truncate">{e.title}</span>
    </button>
  );
}

function EventRow({ e, tz, onOpen }: { e: AgendaEventView; tz: string; onOpen: () => void }) {
  const closed = e.status !== "scheduled";
  const overdue = !closed && (e.endsAt ?? e.startsAt).getTime() < Date.now();
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-muted"
      >
        <span className="w-24 shrink-0 text-sm font-semibold tabular">
          {e.allDay
            ? "Todo el día"
            : `${hmInTz(e.startsAt, tz)}${e.endsAt ? `–${hmInTz(e.endsAt, tz)}` : ""}`}
        </span>
        <span className={cn("size-2 shrink-0 rounded-full", TYPE_DOT[e.type])} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate font-medium", closed && "text-muted-foreground line-through")}>
            {e.title}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {[EVENT_TYPE_LABELS[e.type], e.contactName, e.propertyCode, e.assignedName]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
        {overdue && (
          <span className="shrink-0 rounded bg-warning-soft px-1.5 py-0.5 text-xs">Sin cerrar</span>
        )}
      </button>
    </li>
  );
}

export function AgendaBoard({
  events,
  view,
  anchor,
  rangeStart,
  days,
  tz,
  assignees,
  canCreate,
  defaultType,
}: {
  events: AgendaEventView[];
  view: AgendaView;
  anchor: string;
  rangeStart: string;
  days: number;
  tz: string;
  assignees: { userId: string; name: string }[] | null;
  canCreate: boolean;
  defaultType?: EventType;
}) {
  const [selected, setSelected] = useState<AgendaEventView | null>(null);
  const [editing, setEditing] = useState<AgendaEventView | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [defaults, setDefaults] = useState<EventFormDefaults | undefined>();
  const today = ymdInTz(new Date(), tz);

  const byDay = useMemo(() => {
    const map = new Map<string, AgendaEventView[]>();
    for (const e of events) {
      const k = ymdInTz(e.startsAt, tz);
      map.set(k, [...(map.get(k) ?? []), e]);
    }
    return map;
  }, [events, tz]);

  const openNew = (date?: string) => {
    setEditing(null);
    setDefaults({ date: date ?? (anchor >= today ? anchor : today), type: defaultType });
    setFormOpen(true);
  };

  const dayList = Array.from({ length: days }, (_, i) => addDays(rangeStart, i));
  const monthOf = anchor.slice(0, 7);

  return (
    <>
      {canCreate && (
        <div className="mb-4 flex justify-end">
          <Button onClick={() => openNew()}>
            <Plus /> Nuevo evento
          </Button>
        </div>
      )}

      {view === "month" && (
        <Card className="overflow-hidden">
          <div className="grid grid-cols-7 border-b bg-surface-muted text-center text-xs font-medium text-muted-foreground uppercase">
            {WEEKDAYS.map((d) => (
              <div key={d} className="py-2">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {dayList.map((d) => {
              const list = byDay.get(d) ?? [];
              const inMonth = d.slice(0, 7) === monthOf;
              return (
                <div
                  key={d}
                  className={cn(
                    "group min-h-24 border-r border-b p-1 last:border-r-0 sm:min-h-28 [&:nth-child(7n)]:border-r-0",
                    !inMonth && "bg-surface-muted/50 text-muted-foreground",
                  )}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span
                      className={cn(
                        "flex size-6 items-center justify-center rounded-full text-xs tabular",
                        d === today && "bg-primary font-semibold text-primary-foreground",
                      )}
                    >
                      {Number(d.slice(8))}
                    </span>
                    {canCreate && (
                      <button
                        type="button"
                        onClick={() => openNew(d)}
                        className="rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-surface-muted focus:opacity-100"
                        aria-label={`Agendar el ${formatDayLong(d)}`}
                      >
                        <Plus className="size-3.5" />
                      </button>
                    )}
                  </div>
                  {/* En celular se muestran puntos; en pantallas grandes, los títulos. */}
                  <div className="flex flex-wrap gap-0.5 sm:hidden">
                    {list.slice(0, 6).map((e) => (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => setSelected(e)}
                        aria-label={e.title}
                        className={cn("size-2 rounded-full", TYPE_DOT[e.type])}
                      />
                    ))}
                  </div>
                  <div className="hidden space-y-0.5 sm:block">
                    {list.slice(0, 3).map((e) => (
                      <EventChip key={e.id} e={e} tz={tz} compact onOpen={() => setSelected(e)} />
                    ))}
                    {list.length > 3 && (
                      <p className="px-1 text-[11px] text-muted-foreground">+{list.length - 3} más</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {view === "week" && (
        <div className="grid gap-3 md:grid-cols-7">
          {dayList.map((d, i) => {
            const list = byDay.get(d) ?? [];
            return (
              <Card key={d} className={cn("min-h-40 p-2", d === today && "border-primary/60")}>
                <div className="mb-2 flex items-baseline justify-between px-1">
                  <span className="text-xs text-muted-foreground uppercase">{WEEKDAYS[i]}</span>
                  <span className={cn("text-lg font-semibold tabular", d === today && "text-primary")}>
                    {Number(d.slice(8))}
                  </span>
                </div>
                <div className="space-y-1">
                  {list.map((e) => (
                    <EventChip key={e.id} e={e} tz={tz} onOpen={() => setSelected(e)} />
                  ))}
                  {canCreate && (
                    <button
                      type="button"
                      onClick={() => openNew(d)}
                      className="w-full rounded border border-dashed py-1 text-xs text-muted-foreground hover:bg-surface-muted"
                    >
                      + Agendar
                    </button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {(view === "day" || view === "list") && (
        <div className="space-y-4">
          {dayList.filter((d) => view === "day" || (byDay.get(d)?.length ?? 0) > 0).length === 0 ? (
            <Card>
              <EmptyState
                icon={CalendarX}
                title="Nada agendado"
                description="No hay eventos en este período."
                action={
                  canCreate ? (
                    <Button variant="secondary" onClick={() => openNew()}>
                      <Plus /> Agendar
                    </Button>
                  ) : undefined
                }
              />
            </Card>
          ) : (
            dayList
              .filter((d) => view === "day" || (byDay.get(d)?.length ?? 0) > 0)
              .map((d) => {
                const list = byDay.get(d) ?? [];
                return (
                  <section key={d}>
                    <h2 className={cn("mb-2 text-sm font-semibold", d === today && "text-primary")}>
                      {d === today ? "Hoy · " : ""}
                      {capitalizeFirst(formatDayLong(d))}
                    </h2>
                    <Card>
                      {list.length === 0 ? (
                        <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nada agendado.</p>
                      ) : (
                        <ul className="divide-y">
                          {list.map((e) => (
                            <EventRow key={e.id} e={e} tz={tz} onOpen={() => setSelected(e)} />
                          ))}
                        </ul>
                      )}
                    </Card>
                  </section>
                );
              })
          )}
        </div>
      )}

      <EventDetailDialog
        event={selected}
        tz={tz}
        onOpenChange={(o) => !o && setSelected(null)}
        onEdit={(e) => {
          setSelected(null);
          setEditing(e);
          setFormOpen(true);
        }}
      />
      <EventFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        tz={tz}
        event={editing}
        defaults={defaults}
        assignees={assignees}
      />
    </>
  );
}
