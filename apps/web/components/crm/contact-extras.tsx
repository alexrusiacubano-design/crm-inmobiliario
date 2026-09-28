"use client";

import { CalendarHeart, Link2, Plus, Repeat, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { RELATION_TYPE_LABELS, RELATION_TYPES, type RelationType } from "@crm/shared/crm";
import {
  addContactDateAction,
  addContactRelationAction,
  deleteContactDateAction,
  globalSearchAction,
  removeContactRelationAction,
} from "@/app/(app)/crm/actions";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { Card } from "@/components/ui/misc";

export interface ContactDateView {
  id: string;
  label: string;
  date: string;
  yearly: boolean;
  next: { date: string; days: number } | null;
}

export interface RelationView {
  id: string;
  type: RelationType;
  note: string | null;
  otherId: string | null;
  otherName: string;
  canRemove: boolean;
}

function whenText(d: ContactDateView): string {
  const [y, m, day] = d.date.split("-");
  const base = d.yearly ? `${day}/${m}` : `${day}/${m}/${y}`;
  if (!d.next) return `${base} · pasó`;
  if (d.next.days === 0) return `${base} · hoy`;
  if (d.next.days === 1) return `${base} · mañana`;
  return `${base} · en ${d.next.days} días`;
}

export function ContactDatesCard({
  contactId,
  items,
  canEdit,
}: {
  contactId: string;
  items: ContactDateView[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [date, setDate] = useState("");
  const [yearly, setYearly] = useState(true);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();

  return (
    <Card>
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Fechas importantes</h2>
        {canEdit && !adding && (
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
            <Plus /> Agregar
          </Button>
        )}
      </div>
      {adding && (
        <form
          className="grid gap-3 border-b p-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const r = await addContactDateAction({ contactId, label, date, yearly });
              if (!r.ok) {
                setErrors(r.fieldErrors ?? {});
                return void toast.error(r.error);
              }
              toast.success("Fecha guardada");
              setAdding(false);
              setLabel("");
              setDate("");
              setErrors({});
              router.refresh();
            });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-[1.5fr_1fr]">
            <Field label="Qué" htmlFor="cd-label" error={errors.label}>
              <Input
                id="cd-label"
                value={label}
                placeholder="Cumpleaños, vence el contrato…"
                onChange={(e) => setLabel(e.target.value)}
              />
            </Field>
            <Field label="Fecha" htmlFor="cd-date" error={errors.date}>
              <Input id="cd-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={yearly} onChange={(e) => setYearly(e.target.checked)} /> Se repite todos los
            años
          </label>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setAdding(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button type="submit" size="sm" loading={pending}>
              Guardar
            </Button>
          </div>
        </form>
      )}
      {items.length === 0 ? (
        !adding && <p className="px-4 py-6 text-center text-sm text-muted-foreground">Sin fechas cargadas.</p>
      ) : (
        <ul className="divide-y text-sm">
          {items.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-4 py-2.5">
              <CalendarHeart
                className={
                  d.next && d.next.days <= 7 ? "size-4 text-primary" : "size-4 text-muted-foreground"
                }
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{d.label}</span>
                <span className="block text-xs text-muted-foreground tabular">
                  {whenText(d)}
                  {d.yearly && <Repeat className="ml-1 inline size-3" aria-label="anual" />}
                </span>
              </span>
              {canEdit && (
                <button
                  type="button"
                  className="rounded p-1 text-muted-foreground hover:bg-surface-muted hover:text-danger"
                  aria-label={`Quitar ${d.label}`}
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const r = await deleteContactDateAction(d.id);
                      if (!r.ok) return void toast.error(r.error);
                      router.refresh();
                    })
                  }
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function RelationsCard({
  contactId,
  items,
  canEdit,
}: {
  contactId: string;
  items: RelationView[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ id: string; title: string; subtitle: string | null }[]>([]);
  const [picked, setPicked] = useState<{ id: string; title: string } | null>(null);
  const [type, setType] = useState<RelationType>("spouse");
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [searching, startSearch] = useTransition();

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(
      () =>
        startSearch(async () => {
          const r = await globalSearchAction(q);
          setHits(
            r.ok
              ? r.data
                  .filter((h) => h.entityType === "contact" && h.id !== contactId)
                  .slice(0, 6)
                  .map((h) => ({ id: h.id, title: h.title, subtitle: h.subtitle }))
              : [],
          );
        }),
      250,
    );
    return () => clearTimeout(t);
  }, [q, contactId]);

  return (
    <Card>
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Vínculos</h2>
        {canEdit && !adding && (
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
            <Plus /> Vincular
          </Button>
        )}
      </div>
      {adding && (
        <form
          className="grid gap-3 border-b p-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!picked) return void toast.error("Elegí un contacto");
            startTransition(async () => {
              const r = await addContactRelationAction({
                contactId,
                relatedContactId: picked.id,
                type,
                note,
              });
              if (!r.ok) return void toast.error(r.error);
              toast.success("Vínculo guardado");
              setAdding(false);
              setPicked(null);
              setQ("");
              setNote("");
              router.refresh();
            });
          }}
        >
          {picked ? (
            <div className="flex items-center justify-between rounded-md border bg-surface-muted px-3 py-2 text-sm">
              {picked.title}
              <button type="button" className="text-xs text-primary" onClick={() => setPicked(null)}>
                Cambiar
              </button>
            </div>
          ) : (
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground"
                aria-hidden
              />
              <Input
                aria-label="Buscar contacto"
                className="pl-8"
                placeholder="Buscar contacto por nombre o teléfono…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              {(hits.length > 0 || searching) && (
                <ul className="absolute z-10 mt-1 w-full rounded-md border bg-surface py-1 text-sm shadow-lg">
                  {searching && hits.length === 0 && (
                    <li className="px-3 py-2 text-muted-foreground">Buscando…</li>
                  )}
                  {hits.map((h) => (
                    <li key={h.id}>
                      <button
                        type="button"
                        className="w-full px-3 py-2 text-left hover:bg-surface-muted"
                        onClick={() => setPicked({ id: h.id, title: h.title })}
                      >
                        <span className="block truncate">{h.title}</span>
                        {h.subtitle && (
                          <span className="block truncate text-xs text-muted-foreground">{h.subtitle}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Relación" htmlFor="rel-type">
              <Select id="rel-type" value={type} onChange={(e) => setType(e.target.value as RelationType)}>
                {RELATION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {RELATION_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Nota" htmlFor="rel-note">
              <Input id="rel-note" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setAdding(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button type="submit" size="sm" loading={pending}>
              Guardar
            </Button>
          </div>
        </form>
      )}
      {items.length === 0 ? (
        !adding && <p className="px-4 py-6 text-center text-sm text-muted-foreground">Sin vínculos.</p>
      ) : (
        <ul className="divide-y text-sm">
          {items.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
              <Link2 className="size-4 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1">
                {r.otherId ? (
                  <Link href={`/crm/contacts/${r.otherId}`} className="font-medium hover:underline">
                    {r.otherName}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">{r.otherName}</span>
                )}
                <span className="block text-xs text-muted-foreground">
                  {RELATION_TYPE_LABELS[r.type]}
                  {r.note ? ` · ${r.note}` : ""}
                </span>
              </span>
              {canEdit && r.canRemove && (
                <button
                  type="button"
                  className="rounded p-1 text-muted-foreground hover:bg-surface-muted hover:text-danger"
                  aria-label={`Quitar vínculo con ${r.otherName}`}
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const res = await removeContactRelationAction(r.id);
                      if (!res.ok) return void toast.error(res.error);
                      router.refresh();
                    })
                  }
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
