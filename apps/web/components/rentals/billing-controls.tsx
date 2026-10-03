"use client";

import { Ban, CalendarPlus, Check, HandCoins, Plus, Receipt, Trash2, Wallet, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  CHARGE_LINE_KIND_LABELS,
  CHARGE_LINE_KINDS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  type ChargeLineKind,
  type PaymentMethod,
} from "@crm/shared/billing";
import {
  addChargeLineAction,
  changeSettlementStatusAction,
  createSettlementAction,
  generateChargesAction,
  registerPaymentAction,
  voidPaymentAction,
} from "@/app/(app)/rentals/actions";
import { price } from "@/components/properties/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";

type Currency = "UYU" | "USD";
type Result = { ok: boolean; error?: string; fieldErrors?: Record<string, string[]> };

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const run = (fn: () => Promise<Result>, ok: string | ((r: Result) => string), after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        return void toast.error(r.error);
      }
      setErrors({});
      toast.success(typeof ok === "string" ? ok : ok(r));
      after?.();
      router.refresh();
    });
  return { pending, errors, run };
}

export function GenerateChargesButton({ period, label }: { period: string; label: string }) {
  const { pending, run } = useRun();
  return (
    <Button
      size="sm"
      loading={pending}
      onClick={() =>
        run(
          () => generateChargesAction({ period }),
          (r) => {
            const d = (r as Result & { data?: { created: number; skipped: number } }).data;
            return d?.created ? `${d.created} cuota(s) generada(s)` : "No había cuotas nuevas para generar";
          },
        )
      }
    >
      <CalendarPlus /> Generar cuotas de {label}
    </Button>
  );
}

export function PaymentDialog({
  chargeId,
  balanceMinor,
  currency,
  today,
}: {
  chargeId: string;
  balanceMinor: string;
  currency: Currency;
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const bal = BigInt(balanceMinor);
  const balText =
    bal % 100n === 0n ? (bal / 100n).toString() : `${bal / 100n},${(bal % 100n).toString().padStart(2, "0")}`;
  const [amount, setAmount] = useState(balText);
  const [paidAt, setPaidAt] = useState(today);
  const [method, setMethod] = useState<PaymentMethod>("transfer");
  const [reference, setReference] = useState("");
  const { pending, errors, run } = useRun();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" onClick={() => setOpen(true)}>
        <HandCoins /> Registrar pago
      </Button>
      <DialogContent
        title="Registrar pago"
        description={`Saldo: ${price(balanceMinor, currency)}. Se aceptan pagos parciales.`}
      >
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => registerPaymentAction({ chargeId, amount, paidAt, method, reference }),
              "Pago registrado",
              () => setOpen(false),
            );
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Monto" htmlFor="py-a" error={errors.amount}>
              <Input
                id="py-a"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                autoFocus
              />
            </Field>
            <Field label="Fecha" htmlFor="py-d" error={errors.paidAt}>
              <Input id="py-d" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
            </Field>
            <Field label="Medio" htmlFor="py-m">
              <Select id="py-m" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABELS[m]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Referencia / recibo" htmlFor="py-r">
              <Input id="py-r" value={reference} onChange={(e) => setReference(e.target.value)} />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              Registrar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ChargeLineDialog({ chargeId }: { chargeId: string }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ChargeLineKind>("common_expenses");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const { pending, errors, run } = useRun();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Plus /> Agregar concepto
      </Button>
      <DialogContent
        title="Agregar concepto"
        description="Gastos comunes, contribución, recargo por mora o una bonificación (resta). Los conceptos no se editan: para corregir, agregá una bonificación."
      >
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => addChargeLineAction({ chargeId, kind, description, amount }),
              "Concepto agregado",
              () => {
                setOpen(false);
                setAmount("");
                setDescription("");
              },
            );
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Concepto" htmlFor="ln-k">
              <Select id="ln-k" value={kind} onChange={(e) => setKind(e.target.value as ChargeLineKind)}>
                {CHARGE_LINE_KINDS.filter((k) => k !== "rent").map((k) => (
                  <option key={k} value={k}>
                    {CHARGE_LINE_KIND_LABELS[k]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Monto" htmlFor="ln-a" error={errors.amount}>
              <Input
                id="ln-a"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Detalle" htmlFor="ln-d">
            <Input id="ln-d" value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              Agregar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function VoidPaymentButton({ paymentId }: { paymentId: string }) {
  const { pending, run } = useRun();
  return (
    <Button
      size="sm"
      variant="ghost"
      className="text-danger"
      disabled={pending}
      onClick={() => {
        const reason = window.prompt("Motivo de la anulación (queda un contra-asiento)");
        if (!reason) return;
        run(() => voidPaymentAction({ paymentId, reason }), "Pago anulado");
      }}
    >
      <Ban /> Anular
    </Button>
  );
}

export function SettlementDialog({ chargeId, collectedLabel }: { chargeId: string; collectedLabel: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<{ description: string; amount: string }[]>([]);
  const [notes, setNotes] = useState("");
  const { pending, errors, run } = useRun();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Wallet /> Liquidar al propietario
      </Button>
      <DialogContent
        title="Liquidación al propietario"
        description={`Cobrado: ${collectedLabel}. Se descuenta la comisión de administración del contrato y los descuentos que cargues; el neto se reparte por participación.`}
      >
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => createSettlementAction({ chargeId, deductions: rows, notes }),
              "Liquidación creada (borrador)",
              () => setOpen(false),
            );
          }}
        >
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">
              Descuentos (arreglos, gastos pagados por la inmobiliaria…)
            </legend>
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_8rem_auto] items-end gap-2">
                <Input
                  placeholder="Detalle"
                  value={r.description}
                  onChange={(e) =>
                    setRows(rows.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))
                  }
                />
                <Input
                  placeholder="Monto"
                  inputMode="decimal"
                  value={r.amount}
                  onChange={(e) =>
                    setRows(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))
                  }
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="Quitar"
                  onClick={() => setRows(rows.filter((_, j) => j !== i))}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            {errors.deductions && <p className="text-xs text-danger">{errors.deductions[0]}</p>}
            <div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setRows([...rows, { description: "", amount: "" }])}
              >
                <Plus /> Agregar descuento
              </Button>
            </div>
          </fieldset>
          <Field label="Notas" htmlFor="st-n">
            <Input id="st-n" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              Crear liquidación
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SettlementActions({ id, status, today }: { id: string; status: string; today: string }) {
  const { pending, run } = useRun();
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {status === "draft" && (
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            run(() => changeSettlementStatusAction({ id, status: "approved" }), "Liquidación aprobada")
          }
        >
          <Check /> Aprobar
        </Button>
      )}
      {status === "approved" && (
        <Button
          size="sm"
          disabled={pending}
          onClick={() => {
            const reference =
              window.prompt("Referencia del pago al propietario (transferencia, recibo…)") ?? "";
            run(
              () => changeSettlementStatusAction({ id, status: "paid", paidAt: today, reference }),
              "Marcada como pagada",
            );
          }}
        >
          <Receipt /> Pagada
        </Button>
      )}
      {(status === "draft" || status === "approved") && (
        <Button
          size="sm"
          variant="ghost"
          className="text-danger"
          disabled={pending}
          onClick={() => {
            const reason = window.prompt("Motivo de la anulación");
            if (!reason) return;
            run(() => changeSettlementStatusAction({ id, status: "voided", reason }), "Liquidación anulada");
          }}
        >
          <X /> Anular
        </Button>
      )}
    </div>
  );
}
