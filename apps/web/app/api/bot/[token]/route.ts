import { botRespond, isAppError } from "@crm/core";
import { getDb } from "@crm/db";
import { NextResponse } from "next/server";
import { scheduleAutomations } from "@/lib/automations";

// Límite simple por IP (por instancia): evita que un script llene la bandeja.
const hits = new Map<string, { n: number; reset: number }>();
function limited(ip: string, max: number): boolean {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || h.reset < now) {
    hits.set(ip, { n: 1, reset: now + 10 * 60_000 });
    if (hits.size > 5000) hits.clear();
    return false;
  }
  h.n++;
  return h.n > max;
}

/** Chat público del sitio web. POST { type: "start" | "message" | "search" | "handoff", … } */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const isHandoff = (body as { type?: string } | null)?.type === "handoff";
  if (limited(`${ip}:${isHandoff ? "h" : "m"}`, isHandoff ? 5 : 120))
    return NextResponse.json({ error: "Demasiados mensajes. Probá en unos minutos." }, { status: 429 });
  try {
    const reply = await botRespond(getDb(), token, body);
    if (!reply) return NextResponse.json({ error: "Asistente no disponible" }, { status: 404 });
    if (isHandoff) scheduleAutomations();
    return NextResponse.json(reply, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isAppError(error)) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("[bot] error", error);
    return NextResponse.json({ error: "Error inesperado" }, { status: 500 });
  }
}
