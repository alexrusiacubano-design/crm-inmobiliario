import { appBaseUrl } from "@crm/core";
import { headers } from "next/headers";

/**
 * Dirección pública estable del CRM para enlaces que salen afuera (widget del asistente,
 * feeds de portales, invitaciones, OAuth). Usa BETTER_AUTH_URL o el dominio de producción de
 * Vercel; si no hay ninguno, la dirección con la que se abrió la página.
 */
export async function publicOrigin(): Promise<string> {
  const base = appBaseUrl();
  if (base) return base.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
