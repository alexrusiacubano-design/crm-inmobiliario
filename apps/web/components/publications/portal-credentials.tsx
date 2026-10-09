"use client";

import { KeyRound, Link2, Link2Off, PlugZap, RefreshCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { PORTAL_CREDENTIAL_FIELDS, type Portal } from "@crm/shared/publications";
import {
  clearPortalCredentialsAction,
  connectMercadoLibreAction,
  disconnectPortalAction,
  savePortalCredentialsAction,
  syncPortalsAction,
  testPortalAction,
} from "@/app/(app)/properties/publications/actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Badge } from "@/components/ui/misc";

export interface PortalConnectionView {
  portal: Portal;
  hints: Record<string, string>;
  hasCredentials: boolean;
  connected: boolean;
  accountName: string | null;
  lastError: string | null;
  lastSyncLabel: string | null;
}

/**
 * Credenciales del portal cargadas desde la pantalla (se guardan cifradas; los secretos no se
 * vuelven a mostrar). Mercado Libre se conecta con su autorización (OAuth).
 */
export function PortalCredentials({
  c,
  encryptionReady,
  redirectUri,
}: {
  c: PortalConnectionView;
  encryptionReady: boolean;
  redirectUri: string;
}) {
  const router = useRouter();
  const fields = PORTAL_CREDENTIAL_FIELDS[c.portal];
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, f.secret ? "" : (c.hints[f.key] ?? "")])),
  );
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  if (!fields.length) return null;
  const isMl = c.portal === "mercadolibre";
  const run = (
    fn: () => Promise<{ ok: boolean; error?: string; data?: unknown }>,
    ok?: (d: unknown) => string,
  ) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error);
      if (ok) toast.success(ok(r.data));
      router.refresh();
    });

  return (
    <div className="grid gap-2 border-t pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <KeyRound className="size-4" /> Conexión automática
        </p>
        {isMl ? (
          <Badge tone={c.connected ? "success" : "neutral"}>
            {c.connected ? `Conectado${c.accountName ? `: ${c.accountName}` : ""}` : "Sin conectar"}
          </Badge>
        ) : (
          <Badge tone={c.hasCredentials ? "success" : "neutral"}>
            {c.hasCredentials ? "Credenciales cargadas" : "Sin credenciales"}
          </Badge>
        )}
      </div>
      {c.lastError && <p className="rounded bg-danger/10 px-2 py-1 text-xs text-danger">{c.lastError}</p>}
      {!encryptionReady && (
        <p className="text-xs text-warning">
          Para guardar credenciales falta configurar FIELD_ENCRYPTION_KEY en el servidor.
        </p>
      )}
      {open ? (
        <form
          className="grid gap-2"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await savePortalCredentialsAction({ portal: c.portal, values });
              if (!r.ok) {
                setErrors(r.fieldErrors ?? {});
                return void toast.error(r.error);
              }
              setErrors({});
              setOpen(false);
              setValues((v) =>
                Object.fromEntries(
                  Object.entries(v).map(([k, x]) => [k, fields.find((f) => f.key === k)?.secret ? "" : x]),
                ),
              );
              toast.success("Credenciales guardadas (cifradas)");
              router.refresh();
            });
          }}
        >
          {fields.map((f) => (
            <Field
              key={f.key}
              label={f.label}
              htmlFor={`cr-${c.portal}-${f.key}`}
              error={errors[`values.${f.key}`]}
              hint={
                f.secret && c.hints[f.key]
                  ? `Guardada (${c.hints[f.key]}). Dejá vacío para conservarla.`
                  : f.hint
              }
            >
              <Input
                id={`cr-${c.portal}-${f.key}`}
                type={f.secret ? "password" : "text"}
                autoComplete="off"
                placeholder={f.placeholder}
                value={values[f.key] ?? ""}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              />
            </Field>
          ))}
          {isMl && (
            <p className="text-[11px] text-muted-foreground">
              En tu aplicación de Mercado Libre registrá esta URL de redirección:{" "}
              <code className="break-all">{redirectUri}</code>
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" size="sm" loading={pending} disabled={!encryptionReady}>
              Guardar
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)} disabled={!encryptionReady}>
            <KeyRound /> {c.hasCredentials ? "Cambiar credenciales" : "Cargar credenciales"}
          </Button>
          {isMl && c.hasCredentials && !c.connected && (
            <Button
              size="sm"
              onClick={() =>
                start(async () => {
                  const r = await connectMercadoLibreAction();
                  if (!r.ok) return void toast.error(r.error);
                  window.location.href = r.data.url;
                })
              }
              loading={pending}
            >
              <Link2 /> Conectar con Mercado Libre
            </Button>
          )}
          {(c.connected || (!isMl && c.hasCredentials)) && (
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() =>
                run(
                  () => testPortalAction(c.portal),
                  (d) => (d as { message: string }).message,
                )
              }
            >
              <PlugZap /> Probar conexión
            </Button>
          )}
          {isMl && c.connected && (
            <>
              <Button
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() =>
                  run(
                    () => syncPortalsAction(),
                    (d) => `Sincronizado (${(d as { pushed: number }).pushed} aviso(s) actualizados)`,
                  )
                }
              >
                <RefreshCw /> Sincronizar ahora
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  if (
                    window.confirm(
                      "¿Desconectar la cuenta de Mercado Libre? Los avisos publicados siguen activos allá.",
                    )
                  )
                    run(
                      () => disconnectPortalAction(c.portal),
                      () => "Cuenta desconectada",
                    );
                }}
              >
                <Link2Off /> Desconectar
              </Button>
            </>
          )}
          {c.hasCredentials && (
            <Button
              size="sm"
              variant="ghost"
              className="text-danger"
              disabled={pending}
              onClick={() => {
                if (window.confirm("¿Borrar las credenciales guardadas de este portal?"))
                  run(
                    () => clearPortalCredentialsAction(c.portal),
                    () => "Credenciales borradas",
                  );
              }}
            >
              <Trash2 /> Borrar
            </Button>
          )}
        </div>
      )}
      {isMl && c.connected && (
        <p className="text-[11px] text-muted-foreground">
          Al publicar en Mercado Libre desde la ficha de la propiedad, el aviso se crea solo con fotos, precio
          y datos; pausar, dar de baja o cambiar el precio se refleja allá.{" "}
          {c.lastSyncLabel ? `Última sincronización: ${c.lastSyncLabel}.` : ""}
        </p>
      )}
      {!isMl && c.hasCredentials && (
        <p className="text-[11px] text-muted-foreground">
          La publicación automática se activa cuando el portal entregue la documentación de su API; mientras
          tanto, pasales el listado XML de arriba.
        </p>
      )}
    </div>
  );
}
