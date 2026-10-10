"use client";

import { Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setExclusivityAction } from "@/app/(app)/properties/actions";
import { Input } from "@/components/ui/form";
import { cn } from "@/lib/utils";

/** Exclusividad de la inmobiliaria sobre la propiedad: Sí / No y vencimiento opcional. */
export function ExclusivityToggle({
  propertyId,
  exclusive,
  until,
  canEdit,
}: {
  propertyId: string;
  exclusive: boolean;
  until: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [date, setDate] = useState(until ?? "");
  const save = (next: boolean, nextDate = date) =>
    start(async () => {
      const r = await setExclusivityAction({ propertyId, exclusive: next, exclusiveUntil: nextDate });
      if (!r.ok) return void toast.error(r.error);
      toast.success(next ? "Exclusividad registrada" : "Sin exclusividad");
      router.refresh();
    });
  return (
    <div
      className={cn(
        "grid gap-2 rounded-lg border p-3",
        exclusive ? "border-primary/40 bg-primary-soft/50" : "bg-surface",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Star className={cn("size-4 shrink-0", exclusive ? "fill-primary text-primary" : "text-muted-foreground")} aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-medium">Exclusividad</p>
            <p className="text-xs text-muted-foreground">
              {exclusive ? "Tenemos la exclusividad del inmueble" : "La propiedad no es exclusiva"}
            </p>
          </div>
        </div>
        <div className="flex overflow-hidden rounded-md border text-xs" role="group" aria-label="Exclusividad">
          {[true, false].map((v) => (
            <button
              key={String(v)}
              type="button"
              disabled={!canEdit || pending}
              aria-pressed={exclusive === v}
              onClick={() => exclusive !== v && save(v)}
              className={cn(
                "px-3 py-1.5 disabled:cursor-not-allowed",
                exclusive === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-surface-muted",
              )}
            >
              {v ? "Sí" : "No"}
            </button>
          ))}
        </div>
      </div>
      {exclusive && (
        <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          Vence el
          <Input
            type="date"
            className="h-8 w-40"
            value={date}
            disabled={!canEdit || pending}
            onChange={(e) => setDate(e.target.value)}
            onBlur={() => date !== (until ?? "") && save(true, date)}
          />
        </label>
      )}
    </div>
  );
}
