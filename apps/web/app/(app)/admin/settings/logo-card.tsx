"use client";

import { ImageUp, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/misc";

/** Logo de la inmobiliaria: menú, inicio de sesión, documentos, portal y chat del sitio web. */
export function LogoCard({ logoUrl, orgName }: { logoUrl: string | null; orgName: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const body = new FormData();
      body.set("file", file);
      const res = await fetch("/api/organization/logo", { method: "POST", body });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) toast.error(data.error ?? "No se pudo subir el logo");
      else {
        toast.success("Logo actualizado");
        router.refresh();
      }
    } catch {
      toast.error("Error de red");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  const remove = async () => {
    if (!window.confirm("¿Quitar el logo?")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/organization/logo", { method: "DELETE" });
      if (!res.ok) toast.error("No se pudo quitar el logo");
      else {
        toast.success("Logo quitado");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mb-6 flex max-w-2xl flex-wrap items-center gap-5 p-5">
      <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-neutral-950 p-2">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={`Logo de ${orgName}`} className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="text-3xl font-semibold text-white">{orgName.slice(0, 1).toUpperCase()}</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-medium">Logo</p>
        <p className="text-sm text-muted-foreground">
          Se muestra en el menú, el inicio de sesión, los documentos impresos, el portal del propietario y el
          chat del sitio web. PNG, JPG o WebP de hasta 5 MB; mejor cuadrado y con fondo transparente.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
          />
          <Button type="button" size="sm" loading={busy} onClick={() => input.current?.click()}>
            <ImageUp /> {logoUrl ? "Cambiar logo" : "Subir logo"}
          </Button>
          {logoUrl && (
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void remove()}>
              <Trash2 /> Quitar
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
