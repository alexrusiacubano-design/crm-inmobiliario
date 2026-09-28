"use client";

import { Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { EVENT_TYPE_LABELS, EVENT_TYPES, type EventType } from "@crm/shared/agenda";
import { createEventAction, searchLinksAction, updateEventAction } from "@/app/(app)/agenda/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { addDays, hmInTz, ymdInTz, zonedToDate } from "@/lib/tz";
import type { AgendaEventView } from "./shared";

export interface LinkValue {
  id: string;
  label: string;
}

export interface EventFormDefaults {
  type?: EventType;
  date?: string;
  contact?: LinkValue | null;
  property?: LinkValue | null;
  leadId?: string | null;
  title?: string;
}

function LinkPicker({
  kind,
  label,
  value,
  onChange,
  error,
}: {
  kind: "contact" | "property";
  label: string;
  value: LinkValue | null;
  onChange: (v: LinkValue | null) => void;
  error?: string[];
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<(LinkValue & { hint?: string | null })[]>([]);
  const [searching, startSearch] = useTransition();

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      startSearch(async () => {
        const r = await searchLinksAction(q, kind);
        setHits(r.ok ? r.data.map((h) => ({ id: h.id, label: h.title, hint: h.subtitle })) : []);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [q, kind]);

  const id = `lp-${kind}`;
  return (
    <Field label={label} htmlFor={id} error={error}>
      {value ? (
        <div className="flex h-9 items-center justify-between gap-2 rounded-md border border-border-strong bg-surface-muted px-3 text-sm">
          <span className="truncate">{value.label}</span>
          <button
            type="button"
            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
            aria-label={`Quitar ${label.toLowerCase()}`}
            onClick={() => onChange(null)}
          >
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground"
            aria-hidden
          />
          <Input
            id={id}
            className="pl-8"
            placeholder={kind === "contact" ? "Nombre, teléfono o cédula…" : "Código, título o barrio…"}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoComplete="off"
          />
          {(hits.length > 0 || searching) && (
            <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-surface py-1 text-sm shadow-lg">
              {searching && hits.length === 0 && (
                <li className="px-3 py-2 text-muted-foreground">Buscando…</li>
              )}
              {hits.map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-left hover:bg-surface-muted"
                    onClick={() => {
                      onChange({ id: h.id, label: h.label });
                      setQ("");
                      setHits([]);
                    }}
                  >
                    <span className="block truncate">{h.label}</span>
                    {h.hint && <span className="block truncate text-xs text-muted-foreground">{h.hint}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Field>
  );
}

/** Alta y edición de eventos. Las horas se interpretan en la zona de la organización. */
export function EventFormDialog({
  open,
  onOpenChange,
  tz,
  event,
  defaults,
  assignees,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tz: string;
  event?: AgendaEventView | null;
  defaults?: EventFormDefaults;
  assignees?: { userId: string; name: string }[] | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [type, setType] = useState<EventType>("visit");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [start, setStart] = useState("10:00");
  const [end, setEnd] = useState("11:00");
  const [allDay, setAllDay] = useState(false);
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [contactLink, setContactLink] = useState<LinkValue | null>(null);
  const [propertyLink, setPropertyLink] = useState<LinkValue | null>(null);
  const [assignedUserId, setAssignedUserId] = useState("");

  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (event) {
      setType(event.type);
      setTitle(event.title);
      setDate(ymdInTz(event.startsAt, tz));
      setStart(hmInTz(event.startsAt, tz));
      setEnd(event.endsAt ? hmInTz(event.endsAt, tz) : "");
      setAllDay(event.allDay);
      setLocation(event.location ?? "");
      setDescription(event.description ?? "");
      setContactLink(
        event.contactId ? { id: event.contactId, label: event.contactName ?? "Contacto" } : null,
      );
      setPropertyLink(
        event.propertyId
          ? { id: event.propertyId, label: event.propertyLabel ?? event.propertyCode ?? "Propiedad" }
          : null,
      );
      setAssignedUserId(event.assignedUserId);
    } else {
      const now = new Date();
      setType(defaults?.type ?? "visit");
      setTitle(defaults?.title ?? "");
      setDate(defaults?.date ?? ymdInTz(now, tz));
      setStart("10:00");
      setEnd("11:00");
      setAllDay(false);
      setLocation("");
      setDescription("");
      setContactLink(defaults?.contact ?? null);
      setPropertyLink(defaults?.property ?? null);
      setAssignedUserId("");
    }
  }, [open, event, defaults, tz]);

  const submit = () => {
    const startsAt = zonedToDate(date, allDay ? "00:00" : start, tz);
    let endsAt: Date | null = null;
    if (allDay) endsAt = zonedToDate(addDays(date, 1), "00:00", tz);
    else if (end) endsAt = zonedToDate(date, end, tz);
    const payload = {
      type,
      title: title || (propertyLink && type === "visit" ? `Visita · ${propertyLink.label}` : ""),
      description,
      location,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt ? endsAt.toISOString() : null,
      allDay,
      contactId: contactLink?.id ?? null,
      leadId: event ? event.leadId : (defaults?.leadId ?? null),
      propertyId: propertyLink?.id ?? null,
      assignedUserId: assignedUserId || null,
    };
    startTransition(async () => {
      const r = event
        ? await updateEventAction({ ...payload, id: event.id })
        : await createEventAction(payload);
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        return void toast.error(r.error);
      }
      toast.success(event ? "Evento actualizado" : "Evento agendado");
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={event ? "Editar evento" : "Nuevo evento"}
        description="Visitas, reuniones, llamadas, recordatorios y tareas."
        className="max-w-xl"
      >
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Tipo">
            {EVENT_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={type === t}
                onClick={() => setType(t)}
                className={
                  type === t
                    ? "rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground"
                    : "rounded-full border px-3 py-1 text-xs text-muted-foreground hover:bg-surface-muted"
                }
              >
                {EVENT_TYPE_LABELS[t]}
              </button>
            ))}
          </div>

          <Field label="Título" htmlFor="ev-title" error={errors.title}>
            <Input
              id="ev-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={type === "visit" ? "Se completa con la propiedad si lo dejás vacío" : ""}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-[1.4fr_1fr_1fr]">
            <Field label="Fecha" htmlFor="ev-date" error={errors.startsAt}>
              <Input id="ev-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Desde" htmlFor="ev-start">
              <Input
                id="ev-start"
                type="time"
                value={start}
                disabled={allDay}
                onChange={(e) => setStart(e.target.value)}
              />
            </Field>
            <Field label="Hasta" htmlFor="ev-end" error={errors.endsAt}>
              <Input
                id="ev-end"
                type="time"
                value={end}
                disabled={allDay}
                onChange={(e) => setEnd(e.target.value)}
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> Todo el día
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <LinkPicker
              kind="property"
              label={type === "visit" ? "Propiedad *" : "Propiedad"}
              value={propertyLink}
              onChange={setPropertyLink}
              error={errors.propertyId}
            />
            <LinkPicker
              kind="contact"
              label="Cliente"
              value={contactLink}
              onChange={setContactLink}
              error={errors.contactId}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Lugar" htmlFor="ev-loc" error={errors.location}>
              <Input id="ev-loc" value={location} onChange={(e) => setLocation(e.target.value)} />
            </Field>
            {assignees && (
              <Field label="Responsable" htmlFor="ev-user" error={errors.assignedUserId}>
                <Select
                  id="ev-user"
                  value={assignedUserId}
                  onChange={(e) => setAssignedUserId(e.target.value)}
                >
                  <option value="">{event ? "Sin cambios" : "Yo"}</option>
                  {assignees.map((a) => (
                    <option key={a.userId} value={a.userId}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>

          <Field label="Notas" htmlFor="ev-desc" error={errors.description}>
            <Textarea id="ev-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              {event ? "Guardar" : "Agendar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
