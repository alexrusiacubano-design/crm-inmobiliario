"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { Card } from "@/components/ui/misc";
import { saveSettingsAction } from "./actions";

export function SettingsForm({
  initial,
}: {
  initial: {
    name: string;
    defaultCurrency: "UYU" | "USD";
    timezone: string;
    legalName: string;
    taxId: string;
    address: string;
    phone: string;
    email: string;
    website: string;
  };
}) {
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await saveSettingsAction({
        name: String(f.get("name") ?? ""),
        defaultCurrency: String(f.get("defaultCurrency") ?? ""),
        timezone: String(f.get("timezone") ?? ""),
        legalName: String(f.get("legalName") ?? ""),
        taxId: String(f.get("taxId") ?? ""),
        address: String(f.get("address") ?? ""),
        phone: String(f.get("phone") ?? ""),
        email: String(f.get("email") ?? ""),
        website: String(f.get("website") ?? ""),
      });
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        return void toast.error(result.error);
      }
      setErrors({});
      toast.success("Configuración guardada");
    });
  }

  return (
    <Card className="max-w-2xl">
      <form onSubmit={onSubmit} className="grid gap-4 p-5" noValidate>
        <Field label="Nombre de la inmobiliaria" htmlFor="s-name" error={errors.name}>
          <Input id="s-name" name="name" defaultValue={initial.name} required />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Moneda por defecto"
            htmlFor="s-cur"
            error={errors.defaultCurrency}
            hint="Se propone al cargar precios; cada importe guarda su moneda."
          >
            <Select id="s-cur" name="defaultCurrency" defaultValue={initial.defaultCurrency}>
              <option value="USD">Dólares (U$S)</option>
              <option value="UYU">Pesos uruguayos ($)</option>
            </Select>
          </Field>
          <Field label="Zona horaria" htmlFor="s-tz" error={errors.timezone}>
            <Input id="s-tz" name="timezone" defaultValue={initial.timezone} />
          </Field>
        </div>
        <fieldset className="grid gap-4 border-t pt-4">
          <legend className="text-sm font-semibold">Datos para documentos</legend>
          <p className="-mt-2 text-xs text-muted-foreground">
            Aparecen en recibos, liquidaciones y fichas de propiedades impresas.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Razón social" htmlFor="s-legal" error={errors.legalName}>
              <Input id="s-legal" name="legalName" defaultValue={initial.legalName} />
            </Field>
            <Field label="RUT" htmlFor="s-rut" error={errors.taxId}>
              <Input id="s-rut" name="taxId" inputMode="numeric" defaultValue={initial.taxId} />
            </Field>
            <Field label="Dirección" htmlFor="s-addr" error={errors.address} className="sm:col-span-2">
              <Input id="s-addr" name="address" defaultValue={initial.address} />
            </Field>
            <Field label="Teléfono" htmlFor="s-phone" error={errors.phone}>
              <Input id="s-phone" name="phone" defaultValue={initial.phone} />
            </Field>
            <Field label="Email" htmlFor="s-email" error={errors.email}>
              <Input id="s-email" name="email" type="email" defaultValue={initial.email} />
            </Field>
            <Field label="Sitio web" htmlFor="s-web" error={errors.website} className="sm:col-span-2">
              <Input id="s-web" name="website" defaultValue={initial.website} />
            </Field>
          </div>
        </fieldset>
        <div className="flex justify-end">
          <Button type="submit" loading={pending}>
            Guardar
          </Button>
        </div>
      </form>
    </Card>
  );
}
