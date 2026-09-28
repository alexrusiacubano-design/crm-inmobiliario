"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { VALUATION_METHOD_LABELS, VALUATION_METHODS, type ValuationMethod } from "@crm/shared/property";
import { createValuationAction } from "@/app/(app)/properties/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";

interface Comparable {
  address: string;
  price: string;
  areaM2: string;
  url: string;
}

const today = () => new Date().toISOString().slice(0, 10);

/** Tasación: queda registrada y no se edita (una nueva tasación reemplaza a la anterior). */
export function NewValuationButton({
  propertyId,
  acquisitionId,
  defaultCurrency = "USD",
}: {
  propertyId?: string | null;
  acquisitionId?: string | null;
  defaultCurrency?: "USD" | "UYU";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<ValuationMethod>("comparables");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [value, setValue] = useState("");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [valuedAt, setValuedAt] = useState(today());
  const [notes, setNotes] = useState("");
  const [comparables, setComparables] = useState<Comparable[]>([]);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();

  const reset = () => {
    setMethod("comparables");
    setCurrency(defaultCurrency);
    setValue("");
    setMin("");
    setMax("");
    setValuedAt(today());
    setNotes("");
    setComparables([]);
    setErrors({});
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) reset();
        setOpen(o);
      }}
    >
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        <Plus /> Nueva tasación
      </Button>
      <DialogContent
        title="Nueva tasación"
        description="Queda registrada con fecha y autor. No se edita: si cambia el valor, se carga una nueva."
        className="max-w-2xl"
      >
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const r = await createValuationAction({
                propertyId: propertyId ?? null,
                acquisitionId: acquisitionId ?? null,
                method,
                currency,
                value,
                min,
                max,
                valuedAt,
                notes,
                comparables,
              });
              if (!r.ok) {
                setErrors(r.fieldErrors ?? {});
                return void toast.error(r.error);
              }
              toast.success("Tasación registrada");
              setOpen(false);
              router.refresh();
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Método" htmlFor="va-m">
              <Select id="va-m" value={method} onChange={(e) => setMethod(e.target.value as ValuationMethod)}>
                {VALUATION_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {VALUATION_METHOD_LABELS[m]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Moneda" htmlFor="va-c">
              <Select
                id="va-c"
                value={currency}
                onChange={(e) => setCurrency(e.target.value as "USD" | "UYU")}
              >
                <option value="USD">U$S</option>
                <option value="UYU">$ (UYU)</option>
              </Select>
            </Field>
            <Field label="Fecha" htmlFor="va-d" error={errors.valuedAt}>
              <Input id="va-d" type="date" value={valuedAt} onChange={(e) => setValuedAt(e.target.value)} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Valor estimado" htmlFor="va-v" error={errors.value}>
              <Input id="va-v" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
            </Field>
            <Field label="Rango mínimo" htmlFor="va-min" error={errors.min}>
              <Input id="va-min" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} />
            </Field>
            <Field label="Rango máximo" htmlFor="va-max" error={errors.max}>
              <Input id="va-max" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} />
            </Field>
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Comparables</legend>
            {comparables.map((c, i) => {
              const upd = (patch: Partial<Comparable>) =>
                setComparables(comparables.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              return (
                <div key={i} className="grid items-end gap-2 sm:grid-cols-[2fr_1fr_0.7fr_1.5fr_auto]">
                  <Field label="Dirección" htmlFor={`co-a-${i}`} error={errors[`comparables.${i}.address`]}>
                    <Input
                      id={`co-a-${i}`}
                      value={c.address}
                      onChange={(e) => upd({ address: e.target.value })}
                    />
                  </Field>
                  <Field label="Precio" htmlFor={`co-p-${i}`} error={errors[`comparables.${i}.price`]}>
                    <Input
                      id={`co-p-${i}`}
                      inputMode="decimal"
                      value={c.price}
                      onChange={(e) => upd({ price: e.target.value })}
                    />
                  </Field>
                  <Field label="m²" htmlFor={`co-m-${i}`} error={errors[`comparables.${i}.areaM2`]}>
                    <Input
                      id={`co-m-${i}`}
                      inputMode="decimal"
                      value={c.areaM2}
                      onChange={(e) => upd({ areaM2: e.target.value })}
                    />
                  </Field>
                  <Field label="Enlace" htmlFor={`co-u-${i}`} error={errors[`comparables.${i}.url`]}>
                    <Input
                      id={`co-u-${i}`}
                      value={c.url}
                      onChange={(e) => upd({ url: e.target.value })}
                      placeholder="https://…"
                    />
                  </Field>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Quitar comparable"
                    onClick={() => setComparables(comparables.filter((_, j) => j !== i))}
                  >
                    <Trash2 />
                  </Button>
                </div>
              );
            })}
            {comparables.length < 20 && (
              <div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    setComparables([...comparables, { address: "", price: "", areaM2: "", url: "" }])
                  }
                >
                  <Plus /> Agregar comparable
                </Button>
              </div>
            )}
          </fieldset>
          <Field label="Observaciones" htmlFor="va-n">
            <Textarea id="va-n" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              Registrar tasación
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
