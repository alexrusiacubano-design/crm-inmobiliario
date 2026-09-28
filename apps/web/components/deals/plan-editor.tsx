"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveCommissionPlanAction } from "@/app/(app)/commercial/deals/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";

/** Editor del plan de carrera (solo administración). */
export function PlanEditorButton({
  tiers,
  uyuPerUsd,
}: {
  tiers: { name: string; minBilled: string; rate: string }[];
  uyuPerUsd: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(tiers);
  const [fx, setFx] = useState(uyuPerUsd);
  const [pending, start] = useTransition();

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setRows(tiers);
          setFx(uyuPerUsd);
        }
        setOpen(o);
      }}
    >
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Configurar escalones
      </Button>
      <DialogContent
        title="Plan de carrera"
        description="Escalones por facturación acumulada (la parte de los honorarios cobrados de cada agente, en USD) y el porcentaje que cobra en cada uno."
        className="max-w-xl"
      >
        <form
          className="grid gap-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await saveCommissionPlanAction({ tiers: rows, uyuPerUsd: fx });
              if (!r.ok) return void toast.error(r.error);
              toast.success("Plan guardado");
              setOpen(false);
              router.refresh();
            });
          }}
        >
          {rows.map((r, i) => (
            <div key={i} className="grid items-end gap-2 sm:grid-cols-[1.3fr_1fr_0.6fr_auto]">
              <Field label="Nombre" htmlFor={`pt-n-${i}`}>
                <Input
                  id={`pt-n-${i}`}
                  value={r.name}
                  onChange={(e) =>
                    setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                  }
                />
              </Field>
              <Field label="Desde (USD)" htmlFor={`pt-m-${i}`}>
                <Input
                  id={`pt-m-${i}`}
                  inputMode="decimal"
                  value={r.minBilled}
                  disabled={i === 0}
                  onChange={(e) =>
                    setRows(rows.map((x, j) => (j === i ? { ...x, minBilled: e.target.value } : x)))
                  }
                />
              </Field>
              <Field label="%" htmlFor={`pt-r-${i}`}>
                <Input
                  id={`pt-r-${i}`}
                  inputMode="decimal"
                  value={r.rate}
                  onChange={(e) =>
                    setRows(rows.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))
                  }
                />
              </Field>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Quitar escalón"
                disabled={rows.length === 1 || i === 0}
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="justify-self-start"
            onClick={() => setRows([...rows, { name: "", minBilled: "", rate: "" }])}
          >
            <Plus /> Agregar escalón
          </Button>
          <Field label="Pesos por dólar (para sumar honorarios en pesos)" htmlFor="pt-fx">
            <Input
              id="pt-fx"
              inputMode="decimal"
              value={fx}
              onChange={(e) => setFx(e.target.value)}
              className="max-w-32"
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
