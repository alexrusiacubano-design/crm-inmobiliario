import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Iniciar sesión" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getSessionContext()) redirect("/dashboard");
  const { next } = await searchParams;
  // Solo rutas internas: evita redirecciones abiertas a otros dominios.
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Iniciar sesión</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Ingresá con el usuario que te asignó la administración.
      </p>
      <LoginForm next={safeNext} />
    </>
  );
}
