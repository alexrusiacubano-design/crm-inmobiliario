import { timingSafeEqual } from "node:crypto";
import { dispatchAutomations, runScheduledAutomations } from "@crm/core";
import { getDb } from "@crm/db";
import { NextResponse } from "next/server";

/**
 * Para un cron externo (Vercel Cron, cron-job.org…): entrega los eventos pendientes y corre
 * los disparadores programados de todas las organizaciones.
 * GET /api/cron/automations  con  Authorization: Bearer <CRON_SECRET>
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET no configurado" }, { status: 503 });
  const a = Buffer.from(request.headers.get("authorization") ?? "");
  const b = Buffer.from(`Bearer ${secret}`);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const db = getDb();
  let events = 0;
  for (let i = 0; i < 20; i++) {
    const n = await dispatchAutomations(db, 50);
    events += n;
    if (n < 50) break;
  }
  const scheduled = await runScheduledAutomations(db);
  return NextResponse.json({ events, ...scheduled });
}
