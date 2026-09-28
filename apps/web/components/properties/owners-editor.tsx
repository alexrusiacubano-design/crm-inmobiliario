"use client";

import { Trash2, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { formatBasisPoints, parsePercentToBasisPoints } from "@crm/shared/money";
import { setOwnersAction } from "@/app/(app)/properties/actions";
import { ContactPicker } from "@/components/crm/lead-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/form";

interface Row {
  contactId: string;
  displayName: string;
  sharePercent: string;
}

function toPercentInput(bp: number): string {
  return formatBasisPoints(bp).replace(" %", "");
}

function total(rows: Row[]): number | null {
  try {
    return rows.reduce((acc, r) => acc + parsePercentToBasisPoints(r.sharePercent || "0"), 0);
  } catch {
    return null;
  }
}

/** Editor de copropiedad: contactos existentes con su participación (deben sumar 100 %). */
export function OwnersEditor({
  propertyId,
  initial,
}: {
  propertyId: string;
  initial: { contactId: string; displayName: string; shareBasisPoints: number }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const reset = () => {
    setRows(
      initial.map((o) => ({
        contactId: o.contactId,
        displayName: o.displayName,
        sharePercent: toPercentInput(o.shareBasisPoints),
      })),
    );
    setPicking(initial.length === 0);
    setError(null);
  };
  const sum = total(rows);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) reset();
        setOpen(o);
      }}
    >
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        Editar propietarios
      </Button>
      <DialogContent
        title="Propietarios"
        description="Elegí contactos existentes. Las participaciones deben sumar 100 %."
        className="max-w-xl"
      >
        <div className="grid gap-4">
          {rows.length > 0 && (
            <ul className="divide-y rounded-md border">
              {rows.map((r, i) => (
                <li key={r.contactId} className="flex items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.displayName}</span>
                  <Input
                    aria-label={`Participación de ${r.displayName}`}
                    inputMode="decimal"
                    className="h-8 w-20 text-right"
                    value={r.sharePercent}
                    onChange={(e) =>
                      setRows(rows.map((x, j) => (j === i ? { ...x, sharePercent: e.target.value } : x)))
                    }
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Quitar a ${r.displayName}`}
                    onClick={() => setRows(rows.filter((_, j) => j !== i))}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
              <li className="flex justify-between px-3 py-2 text-sm">
                <span className="text-muted-foreground">Total</span>
                <span className={sum === 10_000 ? "font-medium text-success" : "font-medium text-danger"}>
                  {sum === null ? "Porcentaje inválido" : formatBasisPoints(sum)}
                </span>
              </li>
            </ul>
          )}
          {picking ? (
            <ContactPicker
              onPick={(c) => {
                if (rows.some((r) => r.contactId === c.id)) return void toast.error("Ya está en la lista");
                const remaining = sum !== null ? Math.max(0, 10_000 - sum) : 0;
                setRows([
                  ...rows,
                  { contactId: c.id, displayName: c.displayName, sharePercent: toPercentInput(remaining) },
                ]);
                setPicking(false);
              }}
            />
          ) : (
            <div>
              <Button variant="secondary" size="sm" onClick={() => setPicking(true)}>
                <UserPlus /> Agregar propietario
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            ¿No existe el contacto? Crealo primero en Contactos; así se detectan duplicados.
          </p>
          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button
              loading={pending}
              disabled={rows.length > 0 && sum !== 10_000}
              onClick={() =>
                startTransition(async () => {
                  const r = await setOwnersAction({
                    propertyId,
                    owners: rows.map((x) => ({ contactId: x.contactId, sharePercent: x.sharePercent })),
                  });
                  if (!r.ok) return void setError(r.error);
                  toast.success("Propietarios actualizados");
                  setOpen(false);
                  router.refresh();
                })
              }
            >
              Guardar
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
