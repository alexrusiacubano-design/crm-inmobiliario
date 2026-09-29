"use client";

import { CalendarX2, Percent, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { adjustRent, contractEnd, addDaysYmd } from "@crm/shared/rentals";
import { applyAdjustmentAction, closeContractAction, renewContractAction } from "@/app/(app)/rentals/actions";
import { formatDay, price } from "@/components/properties/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { parsePercentToBasisPoints } from "@crm/shared/money";

type Currency = "UYU" | "USD";

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const run = (
    fn: () => Promise<{
      ok: boolean;
      error?: string;
      fieldErrors?: Record<string, string[]>;
      data?: unknown;
    }>,
    ok: string,
    after?: (data: unknown) => void,
  ) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        return void toast.error(r.error);
      }
      setErrors({});
      toast.success(ok);
      after?.(r.data);
      router.refresh();
    });
  return { pending, errors, run };
}

function previewPercent(rentMinor: string, pct: string): string | null {
  try {
    const neg = pct.trim().startsWith("-");
    const bp = parsePercentToBasisPoints(neg ? pct.trim().slice(1) : pct);
    return adjustRent(BigInt(rentMinor), neg ? -bp : bp).toString();
  } catch {
    return null;
  }
}

export function ContractActions({
  contractId,
  currency,
  rentMinor,
  endDate,
  nextAdjustmentAt,
  today,
}: {
  contractId: string;
  currency: Currency;
  rentMinor: string;
  endDate: string;
  nextAdjustmentAt: string | null;
  today: string;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"adjust" | "renew" | "close" | null>(null);
  const { pending, errors, run } = useRun();
  // Ajuste
  const [effectiveFrom, setEffectiveFrom] = useState(nextAdjustmentAt ?? today);
  const [mode, setMode] = useState<"percent" | "amount">("percent");
  const [pct, setPct] = useState("");
  const [newRent, setNewRent] = useState("");
  const [note, setNote] = useState("");
  // Renovación
  const [months, setMonths] = useState("24");
  const [renewRent, setRenewRent] = useState("");
  // Cierre
  const [kind, setKind] = useState<"ended" | "terminated">(endDate <= today ? "ended" : "terminated");
  const [closeDate, setCloseDate] = useState(endDate <= today ? endDate : today);
  const [reason, setReason] = useState("");

  const preview = mode === "percent" && pct ? previewPercent(rentMinor, pct) : null;
  const renewStart = addDaysYmd(endDate, 1);
  const m = Number(months);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => setDialog("adjust")}>
          <Percent /> Ajustar alquiler
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setDialog("renew")}>
          <RefreshCw /> Renovar
        </Button>
        <Button size="sm" variant="ghost" className="text-danger" onClick={() => setDialog("close")}>
          <CalendarX2 /> Finalizar o rescindir
        </Button>
      </div>

      <Dialog open={dialog === "adjust"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent title="Ajustar alquiler" description={`Hoy: ${price(rentMinor, currency)} por mes.`}>
          <form
            className="grid gap-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () =>
                  applyAdjustmentAction({
                    contractId,
                    effectiveFrom,
                    percent: mode === "percent" ? pct : "",
                    newRent: mode === "amount" ? newRent : "",
                    note,
                  }),
                "Alquiler ajustado",
                () => setDialog(null),
              );
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Desde" htmlFor="aj-d" error={errors.effectiveFrom}>
                <Input
                  id="aj-d"
                  type="date"
                  value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                />
              </Field>
              <Field label="Cómo" htmlFor="aj-m">
                <Select
                  id="aj-m"
                  value={mode}
                  onChange={(e) => setMode(e.target.value as "percent" | "amount")}
                >
                  <option value="percent">Porcentaje (IPC, UI o fijo)</option>
                  <option value="amount">Nuevo monto acordado</option>
                </Select>
              </Field>
            </div>
            {mode === "percent" ? (
              <Field
                label="Porcentaje"
                htmlFor="aj-p"
                error={errors.percent}
                hint={
                  preview
                    ? `Queda en ${price(preview, currency)} (redondeado a pesos enteros)`
                    : "Usá el índice oficial del período"
                }
              >
                <Input
                  id="aj-p"
                  inputMode="decimal"
                  placeholder="5,5"
                  value={pct}
                  onChange={(e) => setPct(e.target.value)}
                />
              </Field>
            ) : (
              <Field label="Nuevo alquiler" htmlFor="aj-n" error={errors.newRent}>
                <Input
                  id="aj-n"
                  inputMode="decimal"
                  value={newRent}
                  onChange={(e) => setNewRent(e.target.value)}
                />
              </Field>
            )}
            <Field label="Nota" htmlFor="aj-note">
              <Input id="aj-note" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setDialog(null)} disabled={pending}>
                Cancelar
              </Button>
              <Button type="submit" loading={pending}>
                Aplicar ajuste
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "renew"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent
          title="Renovar contrato"
          description={`Se crea un contrato nuevo desde el ${formatDay(renewStart)} con las mismas partes y condiciones.`}
        >
          <form
            className="grid gap-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () => renewContractAction({ contractId, months, newRent: renewRent, note }),
                "Contrato renovado",
                (data) => {
                  setDialog(null);
                  const id = (data as { id?: string } | undefined)?.id;
                  if (id) router.push(`/rentals/contracts/${id}`);
                },
              );
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Plazo (meses)"
                htmlFor="rn-m"
                error={errors.months}
                hint={m > 0 && m <= 240 ? `Hasta el ${formatDay(contractEnd(renewStart, m))}` : undefined}
              >
                <Input
                  id="rn-m"
                  inputMode="numeric"
                  value={months}
                  onChange={(e) => setMonths(e.target.value.replace(/\D/g, ""))}
                />
              </Field>
              <Field
                label="Nuevo alquiler"
                htmlFor="rn-r"
                error={errors.newRent}
                hint={`Vacío = sigue en ${price(rentMinor, currency)}`}
              >
                <Input
                  id="rn-r"
                  inputMode="decimal"
                  value={renewRent}
                  onChange={(e) => setRenewRent(e.target.value)}
                />
              </Field>
            </div>
            <Field label="Nota" htmlFor="rn-n">
              <Input id="rn-n" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setDialog(null)} disabled={pending}>
                Cancelar
              </Button>
              <Button type="submit" loading={pending}>
                Renovar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "close"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent
          title="Finalizar o rescindir"
          description="El contrato deja de estar vigente y la propiedad vuelve a estar disponible para alquilar."
        >
          <form
            className="grid gap-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () => closeContractAction({ contractId, kind, date: closeDate, reason }),
                "Contrato cerrado",
                () => setDialog(null),
              );
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Qué pasó" htmlFor="cl-k">
                <Select
                  id="cl-k"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as "ended" | "terminated")}
                >
                  <option value="ended">Finalizó el plazo</option>
                  <option value="terminated">Rescisión anticipada</option>
                </Select>
              </Field>
              <Field label="Fecha de entrega" htmlFor="cl-d" error={errors.date}>
                <Input
                  id="cl-d"
                  type="date"
                  value={closeDate}
                  onChange={(e) => setCloseDate(e.target.value)}
                />
              </Field>
            </div>
            <Field label={kind === "terminated" ? "Motivo" : "Nota"} htmlFor="cl-r" error={errors.reason}>
              <Textarea id="cl-r" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setDialog(null)} disabled={pending}>
                Volver
              </Button>
              <Button type="submit" variant="danger" loading={pending}>
                Confirmar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
