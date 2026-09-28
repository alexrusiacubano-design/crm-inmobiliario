"use client";

import { ShieldCheck, ShieldOff } from "lucide-react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Badge, Card } from "@/components/ui/misc";
import { authClient } from "@/lib/auth-client";

type Step = { kind: "idle" } | { kind: "scan"; qrSvg: string; backupCodes: string[] };

export function TwoFactorPanel({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const start = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    setError(null);
    startTransition(async () => {
      if (enabled) {
        const { error: e } = await authClient.twoFactor.disable({ password });
        if (e) return setError("Contraseña incorrecta.");
        toast.success("Verificación en dos pasos desactivada");
        router.refresh();
        return;
      }
      const { data, error: e } = await authClient.twoFactor.enable({ password });
      if (e || !data) return setError("Contraseña incorrecta.");
      if (data.method !== "totp") return setError("Método de verificación no soportado.");
      const qrSvg = await QRCode.toString(data.totpURI, { type: "svg", margin: 1, width: 200 });
      setStep({ kind: "scan", qrSvg, backupCodes: data.backupCodes });
    });
  };

  const verify = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code") ?? "").trim();
    setError(null);
    startTransition(async () => {
      const { error: e } = await authClient.twoFactor.verifyTotp({ code });
      if (e) return setError("Código incorrecto. Revisá la hora de tu teléfono y probá de nuevo.");
      toast.success("Verificación en dos pasos activada");
      setStep({ kind: "idle" });
      router.refresh();
    });
  };

  return (
    <Card className="max-w-2xl">
      <div className="flex items-start justify-between gap-4 border-b p-5">
        <div>
          <h2 className="font-semibold">Verificación en dos pasos (2FA)</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Además de la contraseña, se pide un código de una app como Google Authenticator, Microsoft
            Authenticator o 1Password.
          </p>
        </div>
        <Badge tone={enabled ? "success" : "neutral"}>{enabled ? "Activa" : "Inactiva"}</Badge>
      </div>

      {step.kind === "idle" ? (
        <form onSubmit={start} className="grid gap-4 p-5 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label="Confirmá tu contraseña" htmlFor="tf-pwd" error={error ?? undefined}>
            <Input id="tf-pwd" name="password" type="password" autoComplete="current-password" required />
          </Field>
          <Button type="submit" variant={enabled ? "secondary" : "primary"} loading={pending}>
            {enabled ? <ShieldOff /> : <ShieldCheck />}
            {enabled ? "Desactivar 2FA" : "Activar 2FA"}
          </Button>
        </form>
      ) : (
        <div className="grid gap-5 p-5 sm:grid-cols-[200px_1fr]">
          {/* SVG generado localmente a partir de la URI TOTP; no se envía a servicios externos. */}
          <div className="rounded-md border bg-white p-2" dangerouslySetInnerHTML={{ __html: step.qrSvg }} />
          <div className="grid content-start gap-4">
            <p className="text-sm">1. Escaneá el código con tu app de autenticación.</p>
            <div className="text-sm">
              <p>2. Guardá estos códigos de respaldo en un lugar seguro. Cada uno sirve una sola vez.</p>
              <ul className="mt-2 grid grid-cols-2 gap-1 rounded-md bg-surface-muted p-3 font-mono text-xs">
                {step.backupCodes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
            <form onSubmit={verify} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <Field label="3. Ingresá el código de 6 dígitos" htmlFor="tf-code" error={error ?? undefined}>
                <Input
                  id="tf-code"
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  className="tabular tracking-widest"
                />
              </Field>
              <Button type="submit" loading={pending}>
                Confirmar
              </Button>
            </form>
          </div>
        </div>
      )}
    </Card>
  );
}
