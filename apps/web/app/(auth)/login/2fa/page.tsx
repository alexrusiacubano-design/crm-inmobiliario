"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Label } from "@/components/ui/form";
import { authClient } from "@/lib/auth-client";

export default function TwoFactorPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"totp" | "backup">("totp");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    const form = new FormData(event.currentTarget);
    const code = String(form.get("code") ?? "").trim();
    const trustDevice = form.get("trust") === "on";
    const result =
      mode === "totp"
        ? await authClient.twoFactor.verifyTotp({ code, trustDevice })
        : await authClient.twoFactor.verifyBackupCode({ code, trustDevice });
    setLoading(false);
    if (result.error) {
      setError(result.error.status === 429 ? "Demasiados intentos. Esperá un minuto." : "Código incorrecto.");
      return;
    }
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Verificación en dos pasos</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {mode === "totp"
          ? "Ingresá el código de 6 dígitos de tu app de autenticación."
          : "Ingresá uno de tus códigos de respaldo."}
      </p>
      <form onSubmit={onSubmit} className="mt-8 grid gap-4">
        <Field label={mode === "totp" ? "Código" : "Código de respaldo"} htmlFor="code">
          <Input
            id="code"
            name="code"
            inputMode={mode === "totp" ? "numeric" : "text"}
            autoComplete="one-time-code"
            required
            autoFocus
            className="tabular tracking-widest"
          />
        </Field>
        <div className="flex items-center gap-2">
          <Checkbox id="trust" name="trust" />
          <Label htmlFor="trust" className="font-normal text-muted-foreground">
            Confiar en este dispositivo por 30 días
          </Label>
        </div>
        {error && (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" loading={loading} className="w-full">
          Verificar
        </Button>
        <Button type="button" variant="link" onClick={() => setMode(mode === "totp" ? "backup" : "totp")}>
          {mode === "totp" ? "Usar un código de respaldo" : "Usar la app de autenticación"}
        </Button>
      </form>
    </>
  );
}
