"use client";

import { Building2, CalendarDays, MapPin, Pencil, Star, Trash2, User, UserCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  EVENT_STATUS_LABELS,
  EVENT_TYPE_LABELS,
  VISIT_OUTCOME_LABELS,
  VISIT_OUTCOMES,
  type EventStatus,
  type VisitOutcome,
} from "@crm/shared/agenda";
import { closeEventAction, deleteEventAction, reopenEventAction } from "@/app/(app)/agenda/actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Badge } from "@/components/ui/misc";
import { formatDayLong, hmInTz, ymdInTz, zonedToDate } from "@/lib/tz";
import { cn } from "@/lib/utils";
import { TYPE_TONE, type AgendaEventView } from "./shared";

type Mode = "view" | "close" | "reopen";

export function whenLabel(e: Pick<AgendaEventView, "startsAt" | "endsAt" | "allDay">, tz: string): string {
  const day = formatDayLong(ymdInTz(e.startsAt, tz));
  if (e.allDay) return `${day} · todo el día`;
  return `${day} · ${hmInTz(e.startsAt, tz)}${e.endsAt ? ` a ${hmInTz(e.endsAt, tz)}` : ""}`;
}

export function EventDetailDialog({
  event,
  tz,
  onOpenChange,
  onEdit,
  initialMode = "view",
}: {
  event: AgendaEventView | null;
  tz: string;
  onOpenChange: (open: boolean) => void;
  onEdit: (e: AgendaEventView) => void;
  initialMode?: Mode;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [status, setStatus] = useState<Exclude<EventStatus, "scheduled">>("done");
  const [outcome, setOutcome] = useState<VisitOutcome | "">("");
  const [rating, setRating] = useState<number | null>(null);
  const [feedback, setFeedback] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!event) return;
    setMode(initialMode);
    setStatus("done");
    setOutcome("");
    setRating(null);
    setFeedback("");
    setErrors({});
    setDate(ymdInTz(new Date(), tz));
    setTime(hmInTz(event.startsAt, tz));
  }, [event, initialMode, tz]);

  if (!event) return null;
  const isVisit = event.type === "visit";
  const open = event.status === "scheduled";
  const overdue = open && (event.endsAt ?? event.startsAt).getTime() < Date.now();

  const finish = (msg: string) => {
    toast.success(msg);
    onOpenChange(false);
    router.refresh();
  };

  return (
    <>
      <Dialog open={!!event} onOpenChange={onOpenChange}>
        <DialogContent title={event.title} description={whenLabel(event, tz)} className="max-w-lg">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={cn("rounded border px-1.5 py-0.5 text-xs font-medium", TYPE_TONE[event.type])}>
              {EVENT_TYPE_LABELS[event.type]}
            </span>
            <Badge
              tone={
                event.status === "done" ? "success" : event.status === "scheduled" ? "outline" : "neutral"
              }
            >
              {EVENT_STATUS_LABELS[event.status]}
            </Badge>
            {overdue && <Badge tone="warning">Pasó sin cerrar</Badge>}
          </div>

          {mode === "view" && (
            <>
              <dl className="grid gap-2 text-sm">
                {event.propertyId && (
                  <div className="flex items-center gap-2">
                    <Building2 className="size-4 text-muted-foreground" aria-hidden />
                    <dt className="sr-only">Propiedad</dt>
                    <dd>
                      <Link href={`/properties/${event.propertyId}`} className="text-primary hover:underline">
                        {event.propertyCode ? `${event.propertyCode} · ` : ""}
                        {event.propertyLabel ?? "Propiedad"}
                      </Link>
                    </dd>
                  </div>
                )}
                {event.contactId && (
                  <div className="flex items-center gap-2">
                    <User className="size-4 text-muted-foreground" aria-hidden />
                    <dt className="sr-only">Cliente</dt>
                    <dd>
                      <Link
                        href={`/crm/contacts/${event.contactId}`}
                        className="text-primary hover:underline"
                      >
                        {event.contactName ?? "Contacto"}
                      </Link>
                    </dd>
                  </div>
                )}
                {event.location && (
                  <div className="flex items-center gap-2">
                    <MapPin className="size-4 text-muted-foreground" aria-hidden />
                    <dt className="sr-only">Lugar</dt>
                    <dd>{event.location}</dd>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <UserCheck className="size-4 text-muted-foreground" aria-hidden />
                  <dt className="sr-only">Responsable</dt>
                  <dd>{event.assignedName ?? "—"}</dd>
                </div>
              </dl>
              {event.description && (
                <p className="rounded-md bg-surface-muted p-3 text-sm whitespace-pre-wrap">
                  {event.description}
                </p>
              )}
              {event.status === "done" && (event.outcome || event.feedback) && (
                <div className="rounded-md border p-3 text-sm">
                  <p className="font-medium">
                    Resultado{event.outcome ? `: ${VISIT_OUTCOME_LABELS[event.outcome]}` : ""}
                    {event.rating ? (
                      <span
                        className="ml-2 inline-flex items-center gap-0.5 text-warning"
                        aria-label={`${event.rating} de 5`}
                      >
                        {Array.from({ length: event.rating }, (_, i) => (
                          <Star key={i} className="size-3.5 fill-current" aria-hidden />
                        ))}
                      </span>
                    ) : null}
                  </p>
                  {event.feedback && (
                    <p className="mt-1 text-muted-foreground whitespace-pre-wrap">{event.feedback}</p>
                  )}
                </div>
              )}
              {event.canManage && (
                <DialogFooter className="sm:justify-between">
                  <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
                    <Trash2 /> Eliminar
                  </Button>
                  <div className="flex flex-col-reverse gap-2 sm:flex-row">
                    {open ? (
                      <>
                        <Button variant="secondary" onClick={() => onEdit(event)}>
                          <Pencil /> Editar
                        </Button>
                        <Button onClick={() => setMode("close")}>
                          {isVisit ? "Marcar cómo salió" : "Completar"}
                        </Button>
                      </>
                    ) : (
                      <Button variant="secondary" onClick={() => setMode("reopen")}>
                        <CalendarDays /> Reprogramar
                      </Button>
                    )}
                  </div>
                </DialogFooter>
              )}
            </>
          )}

          {mode === "close" && (
            <form
              className="grid gap-4"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                startTransition(async () => {
                  const r = await closeEventAction({
                    id: event.id,
                    status,
                    outcome: isVisit && status === "done" ? outcome : null,
                    rating: isVisit && status === "done" ? rating : null,
                    feedback,
                  });
                  if (!r.ok) {
                    setErrors(r.fieldErrors ?? {});
                    return void toast.error(r.error);
                  }
                  finish("Evento cerrado");
                });
              }}
            >
              <Field label="¿Qué pasó?" htmlFor="ce-status">
                <Select
                  id="ce-status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as typeof status)}
                >
                  <option value="done">Se realizó</option>
                  <option value="no_show">No se presentó</option>
                  <option value="cancelled">Se canceló</option>
                </Select>
              </Field>
              {isVisit && status === "done" && (
                <>
                  <Field label="Resultado de la visita" htmlFor="ce-outcome" error={errors.outcome}>
                    <Select
                      id="ce-outcome"
                      value={outcome}
                      onChange={(e) => setOutcome(e.target.value as VisitOutcome)}
                    >
                      <option value="">Elegí una opción</option>
                      {VISIT_OUTCOMES.map((o) => (
                        <option key={o} value={o}>
                          {VISIT_OUTCOME_LABELS[o]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <fieldset>
                    <legend className="mb-1.5 text-sm font-medium">Interés del cliente</legend>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          type="button"
                          aria-label={`${n} de 5`}
                          aria-pressed={rating === n}
                          onClick={() => setRating(rating === n ? null : n)}
                          className="rounded p-1 text-warning hover:bg-surface-muted"
                        >
                          <Star className={cn("size-5", rating !== null && n <= rating && "fill-current")} />
                        </button>
                      ))}
                    </div>
                  </fieldset>
                </>
              )}
              <Field
                label="Comentario"
                htmlFor="ce-fb"
                error={errors.feedback}
                hint="Queda en el historial del cliente."
              >
                <Textarea id="ce-fb" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
              </Field>
              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => setMode("view")} disabled={pending}>
                  Volver
                </Button>
                <Button type="submit" loading={pending}>
                  Guardar
                </Button>
              </DialogFooter>
            </form>
          )}

          {mode === "reopen" && (
            <form
              className="grid gap-4"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                const startsAt = zonedToDate(date, time, tz);
                const dur = event.endsAt ? event.endsAt.getTime() - event.startsAt.getTime() : null;
                startTransition(async () => {
                  const r = await reopenEventAction({
                    id: event.id,
                    startsAt: startsAt.toISOString(),
                    endsAt: dur !== null ? new Date(startsAt.getTime() + dur).toISOString() : null,
                  });
                  if (!r.ok) {
                    setErrors(r.fieldErrors ?? {});
                    return void toast.error(r.error);
                  }
                  finish("Evento reprogramado");
                });
              }}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Nueva fecha" htmlFor="ro-d" error={errors.startsAt}>
                  <Input id="ro-d" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </Field>
                <Field label="Hora" htmlFor="ro-t">
                  <Input id="ro-t" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                </Field>
              </div>
              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => setMode("view")} disabled={pending}>
                  Volver
                </Button>
                <Button type="submit" loading={pending}>
                  Reprogramar
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Eliminar evento"
        description="Se quita de la agenda. Queda registrado en la auditoría."
        confirmLabel="Eliminar"
        loading={pending}
        onConfirm={() =>
          startTransition(async () => {
            const r = await deleteEventAction(event.id);
            if (!r.ok) return void toast.error(r.error);
            setConfirmDelete(false);
            finish("Evento eliminado");
          })
        }
      />
    </>
  );
}
