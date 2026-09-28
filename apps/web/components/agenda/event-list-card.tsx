"use client";

import { useState } from "react";
import { EVENT_TYPE_LABELS } from "@crm/shared/agenda";
import { hmInTz, ymdInTz } from "@/lib/tz";
import { cn } from "@/lib/utils";
import { EventDetailDialog } from "./event-detail-dialog";
import { EventFormDialog } from "./event-form-dialog";
import { TYPE_DOT, type AgendaEventView } from "./shared";

/**
 * Lista compacta de eventos que abre el detalle al hacer clic (dashboard y fichas). Con
 * `closeFirst`, el detalle abre directo en "cómo salió" (visitas sin cerrar).
 */
export function EventListCard({
  events,
  tz,
  showDate,
  closeFirst,
  assignees,
}: {
  events: AgendaEventView[];
  tz: string;
  showDate?: boolean;
  closeFirst?: boolean;
  assignees?: { userId: string; name: string }[] | null;
}) {
  const [selected, setSelected] = useState<AgendaEventView | null>(null);
  const [editing, setEditing] = useState<AgendaEventView | null>(null);
  const today = ymdInTz(new Date(), tz);

  return (
    <>
      <ul className="divide-y">
        {events.map((e) => {
          const closed = e.status !== "scheduled";
          const day = ymdInTz(e.startsAt, tz);
          return (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => setSelected(e)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-muted"
              >
                <span className={cn("size-2 shrink-0 rounded-full", TYPE_DOT[e.type])} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block truncate text-sm font-medium",
                      closed && "text-muted-foreground line-through",
                    )}
                  >
                    {e.title}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[EVENT_TYPE_LABELS[e.type], e.contactName, e.propertyCode].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="shrink-0 text-right text-sm font-semibold text-primary tabular">
                  {showDate && day !== today && (
                    <span className="block text-[11px] font-normal text-muted-foreground">
                      {day.slice(8)}/{day.slice(5, 7)}
                    </span>
                  )}
                  {e.allDay ? "Día" : hmInTz(e.startsAt, tz)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <EventDetailDialog
        event={selected}
        tz={tz}
        initialMode={closeFirst && selected?.canManage && selected.status === "scheduled" ? "close" : "view"}
        onOpenChange={(o) => !o && setSelected(null)}
        onEdit={(e) => {
          setSelected(null);
          setEditing(e);
        }}
      />
      <EventFormDialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        tz={tz}
        event={editing}
        assignees={assignees}
      />
    </>
  );
}
