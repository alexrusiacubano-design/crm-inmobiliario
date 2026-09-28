"use client";

import { Building, Eye, Landmark, Pencil } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { revealAccountAction, saveOwnerProfileAction } from "@/app/(app)/crm/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Card, EmptyState } from "@/components/ui/misc";

export interface OwnerView {
  authorizationNotes: string | null;
  hasBankAccount: boolean;
  bank: {
    bankName: string | null;
    accountHolder: string | null;
    accountCurrency: "UYU" | "USD" | null;
    accountNumberMasked: string | null;
  } | null;
}

function OwnerForm({
  contactId,
  owner,
  canFinancial,
  onDone,
}: {
  contactId: string;
  owner: OwnerView | null;
  canFinancial: boolean;
  onDone: () => void;
}) {
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await saveOwnerProfileAction({
        contactId,
        authorizationNotes: String(f.get("authorizationNotes") ?? ""),
        ...(canFinancial
          ? {
              bankName: String(f.get("bankName") ?? ""),
              accountHolder: String(f.get("accountHolder") ?? ""),
              accountNumber: String(f.get("accountNumber") ?? ""),
              accountCurrency: String(f.get("accountCurrency") ?? "") || null,
            }
          : {}),
      });
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        return void toast.error(r.error);
      }
      toast.success("Datos de propietario guardados");
      onDone();
    });
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field
        label="Poderes y autorizaciones"
        htmlFor="o-notes"
        error={errors.authorizationNotes}
        hint="Quién puede firmar, poderes notariales, observaciones."
      >
        <Textarea
          id="o-notes"
          name="authorizationNotes"
          rows={3}
          defaultValue={owner?.authorizationNotes ?? ""}
        />
      </Field>
      {canFinancial ? (
        <fieldset className="grid gap-4 rounded-md border p-4">
          <legend className="px-1 text-sm font-medium">Cuenta para liquidaciones</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Banco" htmlFor="o-bank" error={errors.bankName}>
              <Input
                id="o-bank"
                name="bankName"
                defaultValue={owner?.bank?.bankName ?? ""}
                placeholder="BROU, Itaú, Santander…"
              />
            </Field>
            <Field label="Moneda" htmlFor="o-cur">
              <Select id="o-cur" name="accountCurrency" defaultValue={owner?.bank?.accountCurrency ?? ""}>
                <option value="">—</option>
                <option value="UYU">Pesos (UYU)</option>
                <option value="USD">Dólares (USD)</option>
              </Select>
            </Field>
          </div>
          <Field label="Titular" htmlFor="o-holder" error={errors.accountHolder}>
            <Input id="o-holder" name="accountHolder" defaultValue={owner?.bank?.accountHolder ?? ""} />
          </Field>
          <Field
            label="Número de cuenta"
            htmlFor="o-account"
            error={errors.accountNumber}
            hint={
              owner?.hasBankAccount
                ? `Guardado: ${owner.bank?.accountNumberMasked}. Dejalo vacío para no cambiarlo.`
                : "Se guarda cifrado."
            }
          >
            <Input id="o-account" name="accountNumber" autoComplete="off" />
          </Field>
        </fieldset>
      ) : (
        <p className="text-xs text-muted-foreground">Tu rol no permite ver ni editar datos bancarios.</p>
      )}
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onDone} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" loading={pending}>
          Guardar
        </Button>
      </DialogFooter>
    </form>
  );
}

export function OwnerPanel({
  contactId,
  owner,
  canUpdate,
  canFinancialRead,
  canFinancialUpdate,
}: {
  contactId: string;
  owner: OwnerView | null;
  canUpdate: boolean;
  canFinancialRead: boolean;
  canFinancialUpdate: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [revealing, startReveal] = useTransition();

  const reveal = () =>
    startReveal(async () => {
      const r = await revealAccountAction(contactId);
      if (!r.ok) return void toast.error(r.error);
      setRevealed(r.data);
      toast.info("La consulta del número completo quedó registrada en la auditoría.");
    });

  const dialog = (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent title={owner ? "Datos de propietario" : "Registrar como propietario"}>
        {open && (
          <OwnerForm
            contactId={contactId}
            owner={owner}
            canFinancial={canFinancialUpdate}
            onDone={() => setOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );

  if (!owner) {
    return (
      <Card>
        <EmptyState
          icon={Building}
          title="No es propietario"
          description="Registralo como propietario para asociarle propiedades (Fase 3) y liquidaciones (Fase 9)."
          action={
            canUpdate ? (
              <Button variant="secondary" onClick={() => setOpen(true)}>
                Registrar como propietario
              </Button>
            ) : undefined
          }
        />
        {dialog}
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Building className="size-4 text-muted-foreground" aria-hidden /> Propietario
        </h3>
        {canUpdate && (
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
            <Pencil /> Editar
          </Button>
        )}
      </div>
      <dl className="grid gap-3 p-4 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Poderes y autorizaciones</dt>
          <dd className="whitespace-pre-wrap">{owner.authorizationNotes || "—"}</dd>
        </div>
        <div>
          <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Landmark className="size-3.5" aria-hidden /> Cuenta para liquidaciones
          </dt>
          {!canFinancialRead ? (
            <dd className="text-muted-foreground">
              {owner.hasBankAccount ? "Registrada (restringida a tu rol)" : "Sin registrar"}
            </dd>
          ) : owner.bank?.bankName || owner.hasBankAccount ? (
            <dd className="grid gap-0.5">
              <span>
                {owner.bank?.bankName ?? "—"}{" "}
                {owner.bank?.accountCurrency ? `· ${owner.bank.accountCurrency}` : ""}
              </span>
              <span className="text-muted-foreground">{owner.bank?.accountHolder}</span>
              {owner.hasBankAccount && (
                <span className="flex items-center gap-2">
                  <span className="font-mono">{revealed ?? owner.bank?.accountNumberMasked}</span>
                  {!revealed && (
                    <Button variant="ghost" size="sm" onClick={reveal} loading={revealing}>
                      <Eye /> Ver completo
                    </Button>
                  )}
                </span>
              )}
            </dd>
          ) : (
            <dd className="text-muted-foreground">Sin registrar</dd>
          )}
        </div>
      </dl>
      {dialog}
    </Card>
  );
}
