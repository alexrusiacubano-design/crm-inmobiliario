"use client";

import { Target } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { GOAL_METRIC_LABELS, GOAL_METRICS, type GoalMetric } from "@crm/shared/performance";
import { saveGoalsAction } from "@/app/(app)/performance/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";

/** Metas mensuales: generales (sin usuario) o de una persona. Vacío = sin meta. */
export function GoalsEditorButton({
  userId,
  userName,
  current,
}: {
  userId: string | null;
  userName?: string;
  current: Partial<Record<GoalMetric, number | null>>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o)
          setValues(
            Object.fromEntries(GOAL_METRICS.map((m) => [m, current[m] == null ? "" : String(current[m])])),
          );
        setOpen(o);
      }}
    >
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          setValues(
            Object.fromEntries(GOAL_METRICS.map((m) => [m, current[m] == null ? "" : String(current[m])])),
          );
          setOpen(true);
        }}
      >
        <Target /> {userId ? `Metas de ${userName ?? "la persona"}` : "Metas generales"}
      </Button>
      <DialogContent
        title={userId ? `Metas mensuales · ${userName ?? ""}` : "Metas mensuales generales"}
        description={
          userId
            ? "Pisan a las generales. Dejá vacío para usar la general."
            : "Se aplican a quien no tenga metas propias. Para semana o trimestre se prorratean."
        }
      >
        <form
          className="grid gap-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await saveGoalsAction({
                userId,
                goals: GOAL_METRICS.map((m) => ({ metric: m, monthlyTarget: values[m] ?? "" })),
              });
              if (!r.ok) return void toast.error(r.error);
              toast.success("Metas guardadas");
              setOpen(false);
              router.refresh();
            });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {GOAL_METRICS.map((m) => (
              <Field key={m} label={GOAL_METRIC_LABELS[m].label} htmlFor={`g-${m}`}>
                <Input
                  id={`g-${m}`}
                  inputMode="numeric"
                  value={values[m] ?? ""}
                  onChange={(e) => setValues({ ...values, [m]: e.target.value.replace(/\D/g, "") })}
                />
              </Field>
            ))}
          </div>
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
