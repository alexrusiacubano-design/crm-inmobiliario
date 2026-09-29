"use client";

import { FileSignature } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  ADJUSTMENT_INDEX_LABELS,
  ADJUSTMENT_INDEXES,
  contractEnd,
  type AdjustmentIndex,
} from "@crm/shared/rentals";
import { createContractAction } from "@/app/(app)/rentals/actions";
import { Picker } from "@/components/deals/new-deal-dialog";
import { formatDay } from "@/components/properties/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";

type Currency = "UYU" | "USD";
interface Link {
  id: string;
  label: string;
}

export interface ContractPreset {
  dealId?: string;
  property?: Link;
  tenant?: Link;
  currency?: Currency;
  rent?: string;
}

const firstOfNextMonth = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth() + 1, 1)).toISOString().slice(0, 10);
};

export function NewContractButton({
  preset,
  label = "Nuevo contrato",
  variant = "primary",
}: {
  preset?: ContractPreset;
  label?: string;
  variant?: "primary" | "secondary";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [prop, setProp] = useState<Link | null>(preset?.property ?? null);
  const [tenant, setTenant] = useState<Link | null>(preset?.tenant ?? null);
  const [startDate, setStartDate] = useState(firstOfNextMonth());
  const [months, setMonths] = useState("24");
  const [currency, setCurrency] = useState<Currency>(preset?.currency ?? "UYU");
  const [rent, setRent] = useState(preset?.rent ?? "");
  const [paymentDay, setPaymentDay] = useState("10");
  const [index, setIndex] = useState<AdjustmentIndex>("ipc");
  const [adjMonths, setAdjMonths] = useState("12");
  const [fixed, setFixed] = useState("");
  const [deposit, setDeposit] = useState("");
  const [adminFee, setAdminFee] = useState("");
  const [guarantee, setGuarantee] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();

  const m = Number(months);
  const end = startDate && m > 0 && m <= 240 ? contractEnd(startDate, m) : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant={variant} onClick={() => setOpen(true)}>
        <FileSignature /> {label}
      </Button>
      <DialogContent
        title="Nuevo contrato de alquiler"
        description="La propiedad pasa a Alquilada. El alquiler, los ajustes y las renovaciones quedan en el historial."
        className="max-w-2xl"
      >
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await createContractAction({
                propertyId: prop?.id ?? "",
                tenantContactId: tenant?.id ?? "",
                dealId: preset?.dealId ?? null,
                startDate,
                months,
                currency,
                rent,
                paymentDay,
                adjustmentIndex: index,
                adjustmentMonths: adjMonths,
                fixedAdjustmentPercent: fixed,
                deposit,
                adminFeePercent: adminFee,
                guaranteeNote: guarantee,
                notes,
              });
              if (!r.ok) {
                setErrors(r.fieldErrors ?? {});
                return void toast.error(r.error);
              }
              toast.success("Contrato creado");
              setOpen(false);
              router.push(`/rentals/contracts/${r.data.id}`);
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {preset?.property ? (
              <Field label="Propiedad">
                <p className="flex h-9 items-center rounded-md border bg-surface-muted px-3 text-sm">
                  {preset.property.label}
                </p>
              </Field>
            ) : (
              <Picker
                kind="property"
                label="Propiedad"
                value={prop}
                onChange={setProp}
                error={errors.propertyId}
              />
            )}
            {preset?.tenant ? (
              <Field label="Inquilino">
                <p className="flex h-9 items-center rounded-md border bg-surface-muted px-3 text-sm">
                  {preset.tenant.label}
                </p>
              </Field>
            ) : (
              <Picker
                kind="contact"
                label="Inquilino"
                value={tenant}
                onChange={setTenant}
                error={errors.tenantContactId}
              />
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Inicio" htmlFor="ct-s" error={errors.startDate}>
              <Input id="ct-s" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field
              label="Plazo (meses)"
              htmlFor="ct-m"
              error={errors.months}
              hint={end ? `Vence el ${formatDay(end)}` : undefined}
            >
              <Input
                id="ct-m"
                inputMode="numeric"
                value={months}
                onChange={(e) => setMonths(e.target.value.replace(/\D/g, ""))}
              />
            </Field>
            <Field label="Día de pago" htmlFor="ct-d" error={errors.paymentDay} hint="Del 1 al 28">
              <Input
                id="ct-d"
                inputMode="numeric"
                value={paymentDay}
                onChange={(e) => setPaymentDay(e.target.value.replace(/\D/g, ""))}
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Moneda" htmlFor="ct-c">
              <Select id="ct-c" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
                <option value="UYU">$ (UYU)</option>
                <option value="USD">U$S</option>
              </Select>
            </Field>
            <Field label="Alquiler mensual" htmlFor="ct-r" error={errors.rent}>
              <Input id="ct-r" inputMode="decimal" value={rent} onChange={(e) => setRent(e.target.value)} />
            </Field>
            <Field label="Depósito" htmlFor="ct-dep" error={errors.deposit} hint="Opcional, misma moneda">
              <Input
                id="ct-dep"
                inputMode="decimal"
                value={deposit}
                onChange={(e) => setDeposit(e.target.value)}
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Ajuste" htmlFor="ct-i">
              <Select id="ct-i" value={index} onChange={(e) => setIndex(e.target.value as AdjustmentIndex)}>
                {ADJUSTMENT_INDEXES.map((i) => (
                  <option key={i} value={i}>
                    {ADJUSTMENT_INDEX_LABELS[i]}
                  </option>
                ))}
              </Select>
            </Field>
            {index !== "none" && (
              <Field label="Cada (meses)" htmlFor="ct-am" error={errors.adjustmentMonths}>
                <Input
                  id="ct-am"
                  inputMode="numeric"
                  value={adjMonths}
                  onChange={(e) => setAdjMonths(e.target.value.replace(/\D/g, ""))}
                />
              </Field>
            )}
            {index === "fixed" && (
              <Field label="Porcentaje" htmlFor="ct-f" error={errors.fixedAdjustmentPercent}>
                <Input
                  id="ct-f"
                  inputMode="decimal"
                  placeholder="5"
                  value={fixed}
                  onChange={(e) => setFixed(e.target.value)}
                />
              </Field>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Comisión de administración (%)"
              htmlFor="ct-fee"
              error={errors.adminFeePercent}
              hint="Se descuenta al liquidar al propietario"
            >
              <Input
                id="ct-fee"
                inputMode="decimal"
                value={adminFee}
                onChange={(e) => setAdminFee(e.target.value)}
              />
            </Field>
            <Field label="Garantía" htmlFor="ct-g" hint="Ej.: ANDA, CGN, seguro de alquiler, depósito">
              <Input id="ct-g" value={guarantee} onChange={(e) => setGuarantee(e.target.value)} />
            </Field>
          </div>
          <Field label="Notas" htmlFor="ct-n">
            <Textarea id="ct-n" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              Crear contrato
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
