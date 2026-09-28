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
  initial: { name: string; defaultCurrency: "UYU" | "USD"; timezone: string };
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
        <div className="flex justify-end">
          <Button type="submit" loading={pending}>
            Guardar
          </Button>
        </div>
      </form>
    </Card>
  );
}
