"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  allowedPropertyTransitions,
  PROPERTY_STATUS_LABELS,
  type PropertyStatus,
} from "@crm/shared/property";
import { changePropertyStatusAction } from "@/app/(app)/properties/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/form";

/** Estados que conviene confirmar con un comentario (cierran o sacan la propiedad de oferta). */
const CRITICAL: PropertyStatus[] = ["sold", "rented", "withdrawn", "paused"];

export function PropertyStatusControl({
  propertyId,
  status,
  canWithdraw,
  missing,
}: {
  propertyId: string;
  status: PropertyStatus;
  canWithdraw: boolean;
  missing: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<PropertyStatus | null>(null);
  const [note, setNote] = useState("");
  const options = allowedPropertyTransitions(status).filter((s) => s !== "withdrawn" || canWithdraw);

  const move = (to: PropertyStatus, withNote?: string) =>
    startTransition(async () => {
      const r = await changePropertyStatusAction({ propertyId, status: to, note: withNote || null });
      if (!r.ok) return void toast.error(r.error);
      toast.success(`Estado: ${PROPERTY_STATUS_LABELS[to]}`);
      setTarget(null);
      setNote("");
      router.refresh();
    });

  if (options.length === 0) return null;
  const canPublish = options.includes("published");

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canPublish && (
        <Button
          size="sm"
          loading={pending}
          disabled={missing.length > 0}
          title={missing.length ? `Falta: ${missing.join(", ")}` : undefined}
          onClick={() => move("published")}
        >
          Publicar
        </Button>
      )}
      <Select
        aria-label="Cambiar estado"
        value=""
        disabled={pending}
        className="h-8 w-44 text-sm"
        onChange={(e) => {
          const to = e.target.value as PropertyStatus;
          if (!to) return;
          if (CRITICAL.includes(to)) setTarget(to);
          else move(to);
        }}
      >
        <option value="">Cambiar estado…</option>
        {options
          .filter((s) => s !== "published")
          .map((s) => (
            <option key={s} value={s}>
              {PROPERTY_STATUS_LABELS[s]}
            </option>
          ))}
      </Select>
      <Dialog open={target !== null} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent
          title={target ? `Pasar a “${PROPERTY_STATUS_LABELS[target]}”` : ""}
          description={
            target === "withdrawn"
              ? "La propiedad sale del inventario activo. Se conserva todo su historial y puede volver a borrador."
              : "El cambio queda registrado en el historial con tu comentario."
          }
        >
          <div className="grid gap-4">
            <Field label="Comentario" htmlFor="st-note" hint="Opcional, pero ayuda a entender el historial.">
              <Textarea
                id="st-note"
                rows={3}
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setTarget(null)} disabled={pending}>
                Cancelar
              </Button>
              <Button
                variant={target === "withdrawn" ? "danger" : "primary"}
                loading={pending}
                onClick={() => target && move(target, note)}
              >
                Confirmar
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
