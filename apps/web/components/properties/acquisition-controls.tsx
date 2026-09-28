"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  ACQUISITION_STAGE_LABELS,
  ACQUISITION_STAGES,
  canTransitionAcquisition,
  type AcquisitionStage,
} from "@crm/shared/property";
import { changeAcquisitionStageAction } from "@/app/(app)/properties/actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { cn } from "@/lib/utils";

const PIPELINE: AcquisitionStage[] = [
  "prospect",
  "contacted",
  "valuation",
  "negotiation",
  "authorization",
  "captured",
  "published",
];

export function AcquisitionStepper({ stage }: { stage: AcquisitionStage }) {
  const current = PIPELINE.indexOf(stage);
  return (
    <ol
      className="flex w-full overflow-x-auto rounded-md border bg-surface text-xs"
      aria-label="Etapa de la captación"
    >
      {PIPELINE.map((s, i) => {
        const done = stage !== "lost" && i < current;
        const active = s === stage;
        return (
          <li
            key={s}
            aria-current={active ? "step" : undefined}
            className={cn(
              "flex min-w-24 flex-1 items-center justify-center gap-1 border-r px-2 py-2 last:border-r-0",
              active && "bg-primary font-medium text-primary-foreground",
              done && "bg-primary-soft text-primary",
              !active && !done && "text-muted-foreground",
            )}
          >
            {done && <Check className="size-3" aria-hidden />}
            {ACQUISITION_STAGE_LABELS[s]}
          </li>
        );
      })}
      {stage === "lost" && (
        <li className="flex items-center bg-surface-muted px-3 font-medium text-danger">Perdida</li>
      )}
    </ol>
  );
}

export function AcquisitionStageControl({
  acquisitionId,
  stage,
  authorized,
  hasProperty,
}: {
  acquisitionId: string;
  stage: AcquisitionStage;
  authorized: boolean;
  hasProperty: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [lostOpen, setLostOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [reason, setReason] = useState("");
  const options = ACQUISITION_STAGES.filter((s) => canTransitionAcquisition(stage, s));

  const move = (to: AcquisitionStage, lostReason?: string) =>
    startTransition(async () => {
      const r = await changeAcquisitionStageAction({
        id: acquisitionId,
        stage: to,
        lostReason: lostReason ?? null,
      });
      if (!r.ok) return void toast.error(r.error);
      toast.success(`Etapa: ${ACQUISITION_STAGE_LABELS[to]}`);
      setLostOpen(false);
      setCaptureOpen(false);
      if (to === "captured" && r.data.propertyId && !hasProperty) {
        router.push(`/properties/${r.data.propertyId}`);
      }
      router.refresh();
    });

  if (options.length === 0) return null;
  const idx = PIPELINE.indexOf(stage);
  const next = idx >= 0 ? PIPELINE[idx + 1] : undefined;
  const nextAllowed = next && options.includes(next) ? next : undefined;

  const go = (to: AcquisitionStage) => {
    if (to === "lost") setLostOpen(true);
    else if (to === "captured") setCaptureOpen(true);
    else move(to);
  };

  return (
    <div className="flex flex-wrap gap-2">
      {nextAllowed && (
        <Button
          size="sm"
          loading={pending}
          disabled={nextAllowed === "captured" && !authorized}
          title={
            nextAllowed === "captured" && !authorized
              ? "Falta la autorización de publicación firmada"
              : undefined
          }
          onClick={() => go(nextAllowed)}
        >
          Pasar a {ACQUISITION_STAGE_LABELS[nextAllowed]}
        </Button>
      )}
      <Select
        aria-label="Cambiar etapa"
        value=""
        disabled={pending}
        className="h-8 w-44 text-sm"
        onChange={(e) => e.target.value && go(e.target.value as AcquisitionStage)}
      >
        <option value="">Otra etapa…</option>
        {options
          .filter((s) => s !== nextAllowed)
          .map((s) => (
            <option key={s} value={s}>
              {s === "lost"
                ? "Marcar como perdida"
                : s === "prospect" && stage === "lost"
                  ? "Reabrir"
                  : ACQUISITION_STAGE_LABELS[s]}
            </option>
          ))}
      </Select>
      <ConfirmDialog
        open={captureOpen}
        onOpenChange={setCaptureOpen}
        tone="primary"
        title="Marcar como captada"
        description={
          hasProperty
            ? "La captación queda como captada y se vincula a la propiedad existente."
            : "Se crea la propiedad en borrador con el propietario al 100 %, la comisión y los precios acordados. Después completás fotos y ficha para publicarla."
        }
        confirmLabel="Captar"
        loading={pending}
        onConfirm={() => move("captured")}
      />
      <Dialog open={lostOpen} onOpenChange={setLostOpen}>
        <DialogContent
          title="Marcar como perdida"
          description="El motivo alimenta los reportes de captación."
        >
          <div className="grid gap-4">
            <Field label="Motivo" htmlFor="acq-lost">
              <Input
                id="acq-lost"
                maxLength={300}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ej.: eligió otra inmobiliaria"
              />
            </Field>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setLostOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button
                variant="danger"
                loading={pending}
                disabled={!reason.trim()}
                onClick={() => move("lost", reason)}
              >
                Marcar como perdida
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
