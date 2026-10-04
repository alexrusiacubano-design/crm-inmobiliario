"use client";

import { LogOut, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import { authClient } from "@/lib/auth-client";
import { activatePortalAction, sendOwnerMessageAction } from "./actions";

export function PortalSignOut() {
  const router = useRouter();
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={async () => {
        await authClient.signOut();
        router.replace("/login");
        router.refresh();
      }}
    >
      <LogOut /> Salir
    </Button>
  );
}

export function MessageForm({ propertyId }: { propertyId?: string }) {
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await sendOwnerMessageAction({ propertyId: propertyId ?? null, message });
          if (!r.ok) return void toast.error(r.error);
          toast.success("Mensaje enviado. Tu agente te va a responder a la brevedad.");
          setMessage("");
        });
      }}
    >
      <Textarea
        aria-label="Mensaje para tu agente"
        rows={3}
        placeholder="Escribile a tu agente: dudas, cambios de precio, disponibilidad para visitas…"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />
      <div>
        <Button type="submit" size="sm" loading={pending} disabled={message.trim().length < 3}>
          <Send /> Enviar
        </Button>
      </div>
    </form>
  );
}

export function ActivateForm({ token, email }: { token: string; email: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await activatePortalAction({ token, password, confirm });
          if (!r.ok) {
            setErrors(r.fieldErrors ?? {});
            return void toast.error(r.error);
          }
          const s = await authClient.signIn.email({ email: r.data.email, password });
          if (s.error) {
            toast.success("Cuenta creada. Ingresá con tu email y contraseña.");
            return router.replace("/login");
          }
          router.replace("/portal");
          router.refresh();
        });
      }}
    >
      <Field label="Email" htmlFor="pa-email">
        <Input id="pa-email" value={email} readOnly />
      </Field>
      <Field label="Contraseña" htmlFor="pa-pw" error={errors.password} hint="Al menos 10 caracteres.">
        <Input
          id="pa-pw"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <Field label="Repetí la contraseña" htmlFor="pa-pw2" error={errors.confirm}>
        <Input
          id="pa-pw2"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </Field>
      <Button type="submit" loading={pending}>
        Activar mi acceso
      </Button>
    </form>
  );
}
