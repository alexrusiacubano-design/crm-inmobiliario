import { timingSafeEqual } from "node:crypto";
import { ingestInquiry, isAppError } from "@crm/core";
import { getDb, organization } from "@crm/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

/**
 * Entrada de consultas desde el sitio web, portales o el asistente virtual.
 * POST /api/inquiries?org=<slug>  con header `x-crm-key: <INQUIRY_WEBHOOK_SECRET>` y JSON:
 * { channel, name, phone, email, message, propertyCode, externalRef }
 */
export async function POST(request: Request) {
  const secret = process.env.INQUIRY_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook no configurado" }, { status: 503 });
  const key = request.headers.get("x-crm-key") ?? "";
  const a = Buffer.from(key);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const slug = new URL(request.url).searchParams.get("org");
  if (!slug) return NextResponse.json({ error: "Falta ?org=" }, { status: 400 });
  const db = getDb();
  const [org] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.slug, slug));
  if (!org) return NextResponse.json({ error: "Organización desconocida" }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  try {
    const r = await ingestInquiry(db, org.id, body);
    return NextResponse.json(
      { id: r.inquiry.id, duplicate: r.duplicate },
      { status: r.duplicate ? 200 : 201 },
    );
  } catch (error) {
    if (isAppError(error))
      return NextResponse.json(
        { error: error.message, fields: "fieldErrors" in error ? error.fieldErrors : undefined },
        { status: 422 },
      );
    console.error("[inquiries] error", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
