"use client";

import { Handshake } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { PROPERTY_OPERATION_LABELS, PROPERTY_OPERATIONS, type PropertyOperation } from "@crm/shared/property";
import { createDealAction } from "@/app/(app)/commercial/deals/actions";
import { searchLinksAction } from "@/app/(app)/agenda/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";

interface Link {
  id: string;
  label: string;
}

function Picker({
  kind,
  label,
  value,
  onChange,
  error,
}: {
  kind: "contact" | "property";
  label: string;
  value: Link | null;
  onChange: (v: Link | null) => void;
  error?: string[];
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<(Link & { hint: string | null })[]>([]);
  const [, start] = useTransition();
  useEffect(() => {
    if (q.trim().length < 2) return setHits([]);
    const t = setTimeout(
      () =>
        start(async () => {
          const r = await searchLinksAction(q, kind);
          setHits(r.ok ? r.data.map((h) => ({ id: h.id, label: h.title, hint: h.subtitle })) : []);
        }),
      250,
    );
    return () => clearTimeout(t);
  }, [q, kind]);
  const id = `nd-${kind}`;
  return (
    <Field label={label} htmlFor={id} error={error}>
      {value ? (
        <div className="flex h-9 items-center justify-between rounded-md border bg-surface-muted px-3 text-sm">
          <span className="truncate">{value.label}</span>
          <button type="button" className="text-xs text-primary" onClick={() => onChange(null)}>
            Cambiar
          </button>
        </div>
      ) : (
        <div className="relative">
          <Input
            id={id}
            value={q}
            autoComplete="off"
            placeholder={kind === "property" ? "Código, título o barrio…" : "Nombre, teléfono o cédula…"}
            onChange={(e) => setQ(e.target.value)}
          />
          {hits.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-surface py-1 text-sm shadow-lg">
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

/** Inicia una operación: propiedad + cliente + precio acordado. */
export function NewDealButton({
  preset,
  label = "Nueva operación",
  variant = "primary",
}: {
  preset?: { property?: Link; client?: Link; leadId?: string; operation?: PropertyOperation };
  label?: string;
  variant?: "primary" | "secondary";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [prop, setProp] = useState<Link | null>(null);
  const [client, setClient] = useState<Link | null>(null);
  const [operation, setOperation] = useState<PropertyOperation>("sale");
  const [currency, setCurrency] = useState<"USD" | "UYU">("USD");
  const [price, setPrice] = useState("");
  const [expected, setExpected] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();

  const reset = () => {
    setProp(preset?.property ?? null);
    setClient(preset?.client ?? null);
    setOperation(preset?.operation ?? "sale");
    setCurrency(preset?.operation && preset.operation !== "sale" ? "UYU" : "USD");
    setPrice("");
    setExpected("");
    setNotes("");
    setErrors({});
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant={variant}
        size={variant === "secondary" ? "sm" : "md"}
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        <Handshake /> {label}
      </Button>
      <DialogContent
        title="Nueva operación"
        description="Cuando un cliente decide avanzar con una propiedad. La propiedad pasa a “En negociación”."
        className="max-w-xl"
      >
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!prop || !client) return void toast.error("Elegí la propiedad y el cliente");
            startTransition(async () => {
              const r = await createDealAction({
                propertyId: prop.id,
                clientContactId: client.id,
                leadId: preset?.leadId ?? null,
                operation,
                currency,
                price,
                expectedCloseDate: expected,
                notes,
              });
              if (!r.ok) {
                setErrors(r.fieldErrors ?? {});
                return void toast.error(r.error);
              }
              toast.success("Operación creada");
              setOpen(false);
              router.push(`/commercial/deals/${r.data.id}`);
            });
          }}
        >
          <Picker
            kind="property"
            label="Propiedad"
            value={prop}
            onChange={setProp}
            error={errors.propertyId}
          />
          <Picker
            kind="contact"
            label="Cliente (comprador o inquilino)"
            value={client}
            onChange={setClient}
            error={errors.clientContactId}
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Operación" htmlFor="nd-op" error={errors.operation}>
              <Select
                id="nd-op"
                value={operation}
                onChange={(e) => {
                  const op = e.target.value as PropertyOperation;
                  setOperation(op);
                  setCurrency(op === "sale" ? "USD" : "UYU");
                }}
              >
                {PROPERTY_OPERATIONS.map((o) => (
                  <option key={o} value={o}>
                    {PROPERTY_OPERATION_LABELS[o]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Moneda" htmlFor="nd-cur">
              <Select
                id="nd-cur"
                value={currency}
                onChange={(e) => setCurrency(e.target.value as "USD" | "UYU")}
              >
                <option value="USD">U$S</option>
                <option value="UYU">$ (UYU)</option>
              </Select>
            </Field>
            <Field
              label={operation === "sale" ? "Precio acordado" : "Alquiler mensual"}
              htmlFor="nd-price"
              error={errors.price}
            >
              <Input
                id="nd-price"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Firma estimada" htmlFor="nd-date" error={errors.expectedCloseDate}>
            <Input id="nd-date" type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />
          </Field>
          <Field label="Notas" htmlFor="nd-notes">
            <Textarea id="nd-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              Crear operación
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
