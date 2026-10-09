import { completeMercadoLibreConnection, isAppError } from "@crm/core";
import { getDb } from "@crm/db";
import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/session";

/** Retorno de "Conectar con Mercado Libre". Requiere la sesión de quien inició la conexión. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const base = `${proto}://${host}`;
  const back = (q: string) => NextResponse.redirect(`${base}/admin/integrations?${q}`);
  const session = await getSessionContext();
  if (!session) return NextResponse.redirect(`${base}/login`);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state)
    return back(
      `ml_error=${encodeURIComponent(url.searchParams.get("error_description") ?? "Conexión cancelada")}`,
    );
  try {
    const r = await completeMercadoLibreConnection(getDb(), session.ctx, { code, state, base });
    return back(`ml=${encodeURIComponent(r.nickname)}`);
  } catch (error) {
    const message = isAppError(error) ? error.message : "Error inesperado al conectar";
    if (!isAppError(error)) console.error("[mercadolibre] callback", error);
    return back(`ml_error=${encodeURIComponent(message)}`);
  }
}
