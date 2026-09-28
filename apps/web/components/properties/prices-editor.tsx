"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { PROPERTY_OPERATION_LABELS, type PropertyOperation } from "@crm/shared/property";
import { setPricesAction } from "@/app/(app)/properties/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";

export interface PriceRow {
  operation: PropertyOperation;
  currency: "UYU" | "USD";
  list: string;
  ownerAsking: string;
  minimum: string;
}

/**
 * Edición de precios por operación. El mínimo autorizado solo aparece para quien tiene el
 * permiso; el servidor lo ignora si otro usuario lo envía.
 */
export function PricesEditor({
  propertyId,
  initial,
  canFloor,
}: {
  propertyId: string;
  initial: PriceRow[];
  canFloor: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(initial);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();

  const update = (i: number, patch: Partial<PriceRow>) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setRows(initial);
          setReason("");
          setErrors({});
        }
        setOpen(o);
      }}
    >
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          setRows(initial);
          setReason("");
          setErrors({});
          setOpen(true);
        }}
      >
        Editar precios
      </Button>
      <DialogContent
        title="Precios"
        description="Cada cambio queda en el historial con fecha, usuario y motivo. Nunca se sobrescribe."
        className="max-w-2xl"
      >
        <form
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const r = await setPricesAction({
                propertyId,
                reason,
                prices: rows.map((x) => ({ ...x, minimum: canFloor ? x.minimum : null })),
              });
              if (!r.ok) {
                setErrors(r.fieldErrors ?? {});
                return void toast.error(r.error);
              }
              toast.success(r.data.changed ? "Precios actualizados" : "Sin cambios");
              setOpen(false);
              router.refresh();
            });
          }}
        >
          {rows.map((r, i) => (
            <fieldset key={r.operation} className="grid gap-3 rounded-md border p-3">
              <legend className="px-1 text-sm font-semibold">{PROPERTY_OPERATION_LABELS[r.operation]}</legend>
              <div className={canFloor ? "grid gap-3 sm:grid-cols-4" : "grid gap-3 sm:grid-cols-3"}>
                <Field label="Moneda" htmlFor={`pr-c-${i}`}>
                  <Select
                    id={`pr-c-${i}`}
                    value={r.currency}
                    onChange={(e) => update(i, { currency: e.target.value as "UYU" | "USD" })}
                  >
                    <option value="USD">U$S</option>
                    <option value="UYU">$ (UYU)</option>
                  </Select>
                </Field>
                <Field label="Publicado" htmlFor={`pr-l-${i}`} error={errors[`prices.${i}.list`]}>
                  <Input
                    id={`pr-l-${i}`}
                    inputMode="decimal"
                    value={r.list}
                    onChange={(e) => update(i, { list: e.target.value })}
                  />
                </Field>
                <Field
                  label="Pedido propietario"
                  htmlFor={`pr-o-${i}`}
                  error={errors[`prices.${i}.ownerAsking`]}
                >
                  <Input
                    id={`pr-o-${i}`}
                    inputMode="decimal"
                    value={r.ownerAsking}
                    onChange={(e) => update(i, { ownerAsking: e.target.value })}
                  />
                </Field>
                {canFloor && (
                  <Field
                    label="Mínimo autorizado"
                    htmlFor={`pr-m-${i}`}
                    error={errors[`prices.${i}.minimum`]}
                  >
                    <Input
                      id={`pr-m-${i}`}
                      inputMode="decimal"
                      value={r.minimum}
                      onChange={(e) => update(i, { minimum: e.target.value })}
                    />
                  </Field>
                )}
              </div>
            </fieldset>
          ))}
          <p className="text-xs text-muted-foreground">
            Escribí los importes como en Uruguay: 230.000 o 32.500,50. Se guardan sin decimales flotantes.
          </p>
          <Field
            label="Motivo del cambio"
            htmlFor="pr-reason"
            hint="Opcional, ej.: “Ajuste acordado con el propietario”."
          >
            <Input
              id="pr-reason"
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              Guardar precios
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
