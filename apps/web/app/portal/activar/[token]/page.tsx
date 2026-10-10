import { portalInviteInfo } from "@crm/core";
import { getDb } from "@crm/db";
import type { Metadata } from "next";
import Link from "next/link";
import { ActivateForm } from "../../portal-client";

export const metadata: Metadata = { title: "Activar portal" };
export const dynamic = "force-dynamic";

export default async function ActivatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const info = await portalInviteInfo(getDb(), token);
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm rounded-xl border bg-surface p-6 shadow-sm">
        {info ? (
          <>
            {info.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={info.logoUrl} alt="" className="mb-3 size-16 rounded-lg bg-neutral-950 object-contain p-1" />
          ) : null}
            <p className="text-xs text-muted-foreground">{info.orgName}</p>
            <h1 className="mt-1 text-xl font-semibold">Hola, {info.ownerName}</h1>
            <p className="mt-1 mb-5 text-sm text-muted-foreground">
              Elegí una contraseña para ver tus propiedades, las visitas, ofertas y liquidaciones.
            </p>
            <ActivateForm token={token} email={info.email} />
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold">Enlace no válido</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              La invitación venció o ya se usó. Pedile una nueva a tu inmobiliaria. Si ya activaste tu acceso,{" "}
              <Link href="/login" className="text-primary hover:underline">
                ingresá acá
              </Link>
              .
            </p>
          </>
        )}
      </div>
    </main>
  );
}
