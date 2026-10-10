"use client";

import { Plus, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  DEMAND_LEAD_OPERATIONS,
  LEAD_OPERATION_LABELS,
  LEAD_SOURCE_LABELS,
  LEAD_SOURCES,
  PROPERTY_TYPE_LABELS,
  PROPERTY_TYPES,
  SUPPLY_LEAD_OPERATIONS,
  type LeadOperation,
  type LeadSource,
  type PropertyType,
} from "@crm/shared/crm";
import { createLeadAction, findContactsAction } from "@/app/(app)/crm/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import { ContactFields, emptyContact, toContactPayload } from "./contact-fields";

export type Found = { id: string; displayName: string; phone: string | null; email: string | null };

export function ContactPicker({ onPick }: { onPick: (c: Found) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Found[]>([]);
  const [loading, startLoading] = useTransition();

  useEffect(() => {
    if (q.trim().length < 2) return;
    const handle = setTimeout(() => {
      startLoading(async () => {
        const r = await findContactsAction(q);
        if (r.ok) setResults(r.data);
      });
    }, 250);
    return () => clearTimeout(handle);
  }, [q]);

  return (
    <div className="grid gap-2">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          aria-label="Buscar contacto"
          placeholder="Nombre, teléfono, email o documento"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="pl-8"
          autoFocus
        />
      </div>
      {q.trim().length >= 2 && (
        <ul className="max-h-56 divide-y overflow-y-auto rounded-md border" aria-busy={loading}>
          {results.length === 0 ? (
            <li className="px-3 py-3 text-sm text-muted-foreground">
              {loading ? "Buscando…" : "Sin resultados"}
            </li>
          ) : (
            results.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onPick(c)}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-surface-muted"
                >
                  <span className="font-medium">{c.displayName}</span>
                  <span className="block text-xs text-muted-foreground">
                    {[c.phone, c.email].filter(Boolean).join(" · ") || "Sin datos de contacto"}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function LeadForm({
  preset,
  assignees,
  onDone,
}: {
  preset?: { id: string; displayName: string };
  assignees?: { userId: string; name: string }[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"existing" | "new">(preset ? "existing" : "new");
  const [picked, setPicked] = useState<{ id: string; displayName: string } | null>(preset ?? null);
  const [contact, setContact] = useState(emptyContact);
  const [operation, setOperation] = useState<LeadOperation>("buy");
  const [propertyType, setPropertyType] = useState<PropertyType | "">("");
  const [source, setSource] = useState<LeadSource>("portal");
  const [assignedUserId, setAssignedUserId] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const r = await createLeadAction({
        contactId: mode === "existing" ? picked?.id : null,
        contact: mode === "new" ? toContactPayload(contact) : null,
        operation,
        source,
        assignedUserId: assignedUserId || null,
        notes,
        search: { operation, propertyTypes: propertyType ? [propertyType] : [] },
      });
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        return void toast.error(r.error);
      }
      if (r.data.duplicates.length)
        toast.warning("Lead creado. El contacto nuevo podría estar duplicado: revisalo en su ficha.");
      else toast.success("Lead creado");
      onDone();
      router.push(`/crm/leads/${r.data.id}`);
    });
  };

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      {!preset && (
        <div
          className="inline-flex w-fit rounded-md border p-0.5 text-sm"
          role="radiogroup"
          aria-label="Contacto"
        >
          {(["new", "existing"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                "rounded px-3 py-1",
                mode === m ? "bg-primary-soft font-medium text-primary" : "text-muted-foreground",
              )}
            >
              {m === "new" ? "Contacto nuevo" : "Contacto existente"}
            </button>
          ))}
        </div>
      )}

      {mode === "existing" ? (
        picked ? (
          <div className="flex items-center justify-between rounded-md border bg-surface-muted/50 px-3 py-2 text-sm">
            <span>
              Contacto: <span className="font-medium">{picked.displayName}</span>
            </span>
            {!preset && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Cambiar contacto"
                onClick={() => setPicked(null)}
              >
                <X />
              </Button>
            )}
          </div>
        ) : (
          <>
            <ContactPicker onPick={setPicked} />
            {errors.contactId && <p className="text-xs text-danger">{errors.contactId[0]}</p>}
          </>
        )
      ) : (
        <ContactFields value={contact} onChange={setContact} errors={errors} compact />
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Qué quiere hacer" htmlFor="l-op">
          <Select id="l-op" value={operation} onChange={(e) => setOperation(e.target.value as LeadOperation)}>
            <optgroup label="Busca un inmueble">
              {DEMAND_LEAD_OPERATIONS.map((o) => (
                <option key={o} value={o}>
                  {LEAD_OPERATION_LABELS[o]}
                </option>
              ))}
            </optgroup>
            <optgroup label="Ofrece un inmueble">
              {SUPPLY_LEAD_OPERATIONS.map((o) => (
                <option key={o} value={o}>
                  {LEAD_OPERATION_LABELS[o]}
                </option>
              ))}
            </optgroup>
          </Select>
        </Field>
        <Field label="Tipo de inmueble" htmlFor="l-type">
          <Select
            id="l-type"
            value={propertyType}
            onChange={(e) => setPropertyType(e.target.value as PropertyType | "")}
          >
            <option value="">Cualquiera / sin definir</option>
            {PROPERTY_TYPES.map((t) => (
              <option key={t} value={t}>
                {PROPERTY_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Origen" htmlFor="l-src">
          <Select id="l-src" value={source} onChange={(e) => setSource(e.target.value as LeadSource)}>
            {LEAD_SOURCES.map((s) => (
              <option key={s} value={s}>
                {LEAD_SOURCE_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {assignees && assignees.length > 0 && (
        <Field label="Agente responsable" htmlFor="l-assignee">
          <Select id="l-assignee" value={assignedUserId} onChange={(e) => setAssignedUserId(e.target.value)}>
            <option value="">Yo</option>
            {assignees.map((a) => (
              <option key={a.userId} value={a.userId}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Consulta" htmlFor="l-notes" hint="Qué pidió, por qué propiedad consultó, horarios…">
        <Textarea id="l-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onDone} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" loading={pending} disabled={mode === "existing" && !picked}>
          Crear lead
        </Button>
      </DialogFooter>
    </form>
  );
}

export function NewLeadButton({
  preset,
  assignees,
  variant = "primary",
}: {
  preset?: { id: string; displayName: string };
  assignees?: { userId: string; name: string }[];
  variant?: "primary" | "secondary";
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <Plus /> Nuevo lead
      </Button>
      <DialogContent
        title="Nuevo lead"
        description="Una consulta de compra o alquiler. La búsqueda detallada se completa en la ficha del lead."
        className="max-w-2xl"
      >
        {open && <LeadForm preset={preset} assignees={assignees} onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}
