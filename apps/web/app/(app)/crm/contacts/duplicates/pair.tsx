"use client";

import { GitMerge, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CHANNEL_TYPE_LABELS, type ChannelType } from "@crm/shared/crm";
import { dismissDuplicateAction, mergeContactsAction } from "@/app/(app)/crm/actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Badge, Card } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

interface Side {
  id: string;
  displayName: string;
  documentNumber: string | null;
  createdAt: string;
  channels: { type: ChannelType; value: string }[];
  leadCount: number;
}

const REASONS: Record<string, string> = {
  document: "Mismo documento",
  phone: "Mismo teléfono",
  email: "Mismo email",
  name: "Nombre parecido",
};

export function DuplicatePair({
  id,
  score,
  reasons,
  a,
  b,
}: {
  id: string;
  score: number;
  reasons: string[];
  a: Side;
  b: Side;
}) {
  const router = useRouter();
  const [survivor, setSurvivor] = useState<"a" | "b">(a.leadCount >= b.leadCount ? "a" : "b");
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const keep = survivor === "a" ? a : b;
  const drop = survivor === "a" ? b : a;

  const merge = () =>
    startTransition(async () => {
      const r = await mergeContactsAction({ survivorId: keep.id, mergedId: drop.id });
      if (!r.ok) return void toast.error(r.error);
      toast.success(`Fusionado en ${keep.displayName}`);
      setOpen(false);
      router.refresh();
    });

  const dismiss = () =>
    startTransition(async () => {
      const r = await dismissDuplicateAction(id);
      if (!r.ok) return void toast.error(r.error);
      toast.success("Marcado como no duplicado");
      router.refresh();
    });

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <div className="flex flex-wrap gap-1.5">
          {reasons.map((r) => (
            <Badge key={r} tone="warning">
              {REASONS[r] ?? r}
            </Badge>
          ))}
        </div>
        <span className="text-xs text-muted-foreground tabular">Coincidencia {score}%</span>
      </div>
      <fieldset className="grid gap-3 p-4 sm:grid-cols-2">
        <legend className="sr-only">Elegí cuál se conserva</legend>
        {(["a", "b"] as const).map((k) => {
          const s = k === "a" ? a : b;
          const selected = survivor === k;
          return (
            <label
              key={k}
              className={cn(
                "cursor-pointer rounded-md border p-3 text-sm transition-colors",
                selected ? "border-primary bg-primary-soft/50" : "hover:bg-surface-muted/60",
              )}
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`keep-${id}`}
                  checked={selected}
                  onChange={() => setSurvivor(k)}
                  className="accent-[var(--primary)]"
                />
                <Link href={`/crm/contacts/${s.id}`} className="font-medium hover:underline">
                  {s.displayName}
                </Link>
                {selected && <Badge tone="primary">Se conserva</Badge>}
              </span>
              <ul className="mt-2 grid gap-0.5 pl-6 text-xs text-muted-foreground">
                {s.channels.map((c, i) => (
                  <li key={i}>
                    {CHANNEL_TYPE_LABELS[c.type]}: {c.value}
                  </li>
                ))}
                {s.documentNumber && <li>Documento: {s.documentNumber}</li>}
                <li>
                  {s.leadCount} lead(s) · alta {new Date(s.createdAt).toLocaleDateString("es-UY")}
                </li>
              </ul>
            </label>
          );
        })}
      </fieldset>
      <div className="flex justify-end gap-2 border-t px-4 py-2.5">
        <Button variant="ghost" size="sm" onClick={dismiss} disabled={pending}>
          <X /> No son la misma persona
        </Button>
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          trigger={
            <Button size="sm">
              <GitMerge /> Fusionar
            </Button>
          }
          title="¿Fusionar contactos?"
          description={
            <>
              <strong>{drop.displayName}</strong> se integra en <strong>{keep.displayName}</strong> con todos
              sus datos, leads y timeline. Queda dado de baja y registrado en la auditoría.
            </>
          }
          confirmLabel="Fusionar"
          tone="primary"
          onConfirm={merge}
          loading={pending}
        />
      </div>
    </Card>
  );
}
