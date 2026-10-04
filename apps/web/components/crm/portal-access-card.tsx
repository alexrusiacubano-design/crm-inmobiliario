"use client";

import { Copy, KeyRound, MessageCircle, ShieldOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { invitePortalAction, revokePortalAction } from "@/app/(app)/crm/contacts/portal-actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Badge, Card } from "@/components/ui/misc";
import { whatsappLink } from "@/lib/utils";

export interface PortalAccessView {
  status: "invited" | "active" | "revoked";
  email: string;
  detail: string;
}

/** Acceso del propietario al portal: invitar, reenviar el enlace o quitar el acceso. */
export function PortalAccessCard({
  contactId,
  ownerFirstName,
  access,
  suggestedEmail,
  phone,
  canManage,
}: {
  contactId: string;
  ownerFirstName: string;
  access: PortalAccessView | null;
  suggestedEmail: string | null;
  phone: string | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const [email, setEmail] = useState(access?.email ?? suggestedEmail ?? "");
  const [link, setLink] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  const tone = access?.status === "active" ? "success" : access?.status === "invited" ? "warning" : "neutral";
  const label =
    access?.status === "active"
      ? "Activo"
      : access?.status === "invited"
        ? "Invitado"
        : access
          ? "Sin acceso"
          : "Sin acceso";
  const message = link
    ? `Hola ${ownerFirstName}, te comparto el acceso al portal de propietarios para ver tus propiedades, visitas, ofertas y liquidaciones: ${link} (el enlace vence en 7 días).`
    : "";
  const wa = link ? whatsappLink(phone) : null;

  return (
    <Card>
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <KeyRound className="size-4" /> Portal del propietario
        </h2>
        <Badge tone={tone}>{label}</Badge>
      </div>
      <div className="grid gap-3 p-4 text-sm">
        <p className="text-xs text-muted-foreground">
          Con su propio usuario ve sus propiedades, avisos, visitas, ofertas, cuotas del inquilino y
          liquidaciones (solo lectura) y puede escribirle a su agente.
        </p>
        {access && access.status !== "revoked" && (
          <p className="text-xs">
            {access.email} · {access.detail}
          </p>
        )}
        {canManage && access?.status !== "active" && (
          <form
            className="flex flex-wrap items-end gap-2"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const r = await invitePortalAction({ contactId, email });
                if (!r.ok) {
                  setErrors(r.fieldErrors ?? {});
                  return void toast.error(r.error);
                }
                setErrors({});
                setLink(`${window.location.origin}/portal/activar/${r.data.token}`);
                toast.success("Invitación creada: mandale el enlace");
                router.refresh();
              });
            }}
          >
            <Field
              label="Email del propietario"
              htmlFor="po-email"
              error={errors.email}
              className="min-w-56 flex-1"
            >
              <Input id="po-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Button type="submit" size="sm" loading={pending}>
              {access?.status === "invited" ? "Generar nuevo enlace" : "Invitar al portal"}
            </Button>
          </form>
        )}
        {link && (
          <div className="grid gap-2 rounded-md border bg-surface-muted/50 p-3">
            <p className="text-xs text-muted-foreground">
              Enlace de activación (se muestra una sola vez; vence en 7 días):
            </p>
            <div className="flex items-center gap-1">
              <Input
                readOnly
                value={link}
                className="h-8 font-mono text-xs"
                onFocus={(e) => e.target.select()}
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Copiar mensaje"
                onClick={() => {
                  void navigator.clipboard?.writeText(message);
                  toast.success("Mensaje copiado");
                }}
              >
                <Copy />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {wa && (
                <Button size="sm" variant="secondary" asChild>
                  <a href={`${wa}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">
                    <MessageCircle /> Enviar por WhatsApp
                  </a>
                </Button>
              )}
              <Button size="sm" variant="secondary" asChild>
                <a
                  href={`mailto:${email}?subject=${encodeURIComponent("Acceso al portal de propietarios")}&body=${encodeURIComponent(message)}`}
                >
                  Enviar por email
                </a>
              </Button>
            </div>
          </div>
        )}
        {canManage && access && access.status !== "revoked" && (
          <div>
            <Button
              size="sm"
              variant="ghost"
              className="text-danger"
              disabled={pending}
              onClick={() => {
                if (!window.confirm("¿Quitar el acceso al portal? Se cierran sus sesiones abiertas.")) return;
                start(async () => {
                  const r = await revokePortalAction(contactId);
                  if (!r.ok) return void toast.error(r.error);
                  setLink(null);
                  toast.success("Acceso quitado");
                  router.refresh();
                });
              }}
            >
              <ShieldOff /> Quitar acceso
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
