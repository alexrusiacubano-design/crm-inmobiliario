import { eventsFor, hasPermission, listAgendaAssignees, type RequestContext } from "@crm/core";
import type { Db } from "@crm/db";
import { CalendarDays } from "lucide-react";
import { Card, EmptyState } from "@/components/ui/misc";
import { DEFAULT_TZ } from "@/lib/tz";
import type { EventFormDefaults } from "./event-form-dialog";
import { EventListCard } from "./event-list-card";
import { ScheduleButton } from "./schedule-button";
import { toView } from "./shared";

/** Pestaña "Agenda" de las fichas de contacto y propiedad: próximos eventos e historial. */
export async function EventsPanel({
  db,
  ctx,
  target,
  defaults,
}: {
  db: Db;
  ctx: RequestContext;
  target: { contactId?: string; propertyId?: string };
  defaults: EventFormDefaults;
}) {
  const tz = ctx.organization.timezone || DEFAULT_TZ;
  const canCreate = hasPermission(ctx, "visit.manage") || hasPermission(ctx, "task.manage");
  const [data, assignees] = await Promise.all([
    eventsFor(db, ctx, target),
    canCreate ? listAgendaAssignees(db, ctx) : Promise.resolve(null),
  ]);
  if (!data) {
    return (
      <Card>
        <EmptyState icon={CalendarDays} title="Tu rol no incluye la agenda" />
      </Card>
    );
  }
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Próximas acciones</h2>
          {canCreate && <ScheduleButton tz={tz} defaults={defaults} assignees={assignees} />}
        </div>
        {data.upcoming.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title="Nada agendado"
            description="Agendá una visita, llamada o recordatorio."
          />
        ) : (
          <EventListCard
            events={data.upcoming.map(toView)}
            tz={tz}
            showDate
            closeFirst
            assignees={assignees}
          />
        )}
      </Card>
      <Card>
        <h2 className="border-b px-4 py-3 text-sm font-semibold">Historial</h2>
        {data.past.length === 0 ? (
          <EmptyState icon={CalendarDays} title="Sin eventos cerrados" />
        ) : (
          <EventListCard events={data.past.map(toView)} tz={tz} showDate assignees={assignees} />
        )}
      </Card>
    </div>
  );
}
