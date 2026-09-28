import "server-only";
import { isAppError, ValidationError, type RequestContext } from "@crm/core";
import { getDb, type Db } from "@crm/db";
import { NextResponse } from "next/server";
import { getSessionContext } from "./session";

const STATUS: Record<string, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
};

/**
 * Envoltorio para route handlers (subidas y descargas de archivos, que no pasan por server
 * actions): resuelve la sesión, traduce errores de dominio a HTTP y no filtra detalles internos.
 */
export async function runRoute(
  request: Request,
  fn: (db: Db, ctx: RequestContext) => Promise<Response>,
  options: { mutates?: boolean } = {},
): Promise<Response> {
  if (options.mutates && !sameOrigin(request)) {
    return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  }
  const session = await getSessionContext();
  if (!session)
    return NextResponse.json({ error: "Tu sesión expiró. Volvé a iniciar sesión." }, { status: 401 });
  try {
    return await fn(getDb(), session.ctx);
  } catch (error) {
    if (isAppError(error)) {
      return NextResponse.json(
        { error: error.message, fieldErrors: "fieldErrors" in error ? error.fieldErrors : undefined },
        { status: STATUS[error.code] ?? 400 },
      );
    }
    console.error("[route] error inesperado", { requestId: session.ctx.meta.requestId, error });
    return NextResponse.json(
      { error: `Ocurrió un error inesperado (ref. ${session.ctx.meta.requestId?.slice(0, 8)})` },
      { status: 500 },
    );
  }
}

/** Defensa CSRF adicional a SameSite: las escrituras deben venir de este mismo origen. */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Rechaza cuerpos demasiado grandes antes de leerlos en memoria. */
export function tooLarge(request: Request, maxBytes: number): Response | null {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > maxBytes) {
    return NextResponse.json({ error: "El archivo es demasiado grande" }, { status: 413 });
  }
  return null;
}

export async function readUpload(
  form: FormData,
  field = "file",
): Promise<{ bytes: Buffer; fileName: string }> {
  const file = form.get(field);
  if (!(file instanceof File)) throw new ValidationError("Falta el archivo");
  return { bytes: Buffer.from(await file.arrayBuffer()), fileName: file.name };
}

/** Nombre de archivo seguro para Content-Disposition (RFC 5987). */
export function contentDisposition(kind: "inline" | "attachment", name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
