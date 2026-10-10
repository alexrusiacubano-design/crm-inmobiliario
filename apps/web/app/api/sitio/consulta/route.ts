import { isAppError, submitCatalogInquiry } from "@crm/core";
import { getDb } from "@crm/db";
import { NextResponse } from "next/server";
import { scheduleAutomations } from "@/lib/automations";
import { getSite } from "@/lib/site";

// Límite simple por IP (por instancia) para que un script no llene la bandeja.
const hits = new Map<string, { n: number; reset: number }>();
function limited(ip: string): boolean {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || h.reset < now) {
    hits.set(ip, { n: 1, reset: now + 10 * 60_000 });
    if (hits.size > 5000) hits.clear();
    return false;
  }
  h.n++;
  return h.n > 5;
}

/** Formulario «Me interesa» del sitio web: crea una consulta en Comunicaciones → Consultas. */
export async function POST(request: Request) {
  const site = await getSite();
  if (!site) return NextResponse.json({ error: "Sitio no disponible" }, { status: 404 });
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (limited(ip))
    return NextResponse.json({ error: "Demasiados envíos. Probá en unos minutos." }, { status: 429 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }
  try {
    await submitCatalogInquiry(getDb(), site.id, body);
    scheduleAutomations(site.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isAppError(error)) {
      const fieldErrors = (error as { fieldErrors?: Record<string, string[]> }).fieldErrors;
      return NextResponse.json({ error: error.message, fieldErrors }, { status: 400 });
    }
    console.error("[sitio] consulta", error);
    return NextResponse.json({ error: "No se pudo enviar. Probá de nuevo." }, { status: 500 });
  }
}
