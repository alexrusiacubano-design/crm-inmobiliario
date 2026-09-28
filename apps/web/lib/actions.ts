import "server-only";
import { isAppError, type RequestContext } from "@crm/core";
import { getDb, type Db } from "@crm/db";
import { getSessionContext } from "./session";

export type ActionResult<T = undefined> =
  { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/**
 * Envoltorio para server actions: resuelve la sesión en el servidor, ejecuta el servicio
 * de dominio y traduce los errores conocidos a un resultado serializable. Los errores
 * inesperados se registran y se devuelven con un mensaje genérico (sin filtrar detalles).
 */
export async function runAction<T>(
  fn: (db: Db, ctx: RequestContext) => Promise<T>,
): Promise<ActionResult<T>> {
  const session = await getSessionContext();
  if (!session) return { ok: false, error: "Tu sesión expiró. Volvé a iniciar sesión." };
  try {
    const data = await fn(getDb(), session.ctx);
    return { ok: true, data };
  } catch (error) {
    if (isAppError(error)) {
      return {
        ok: false,
        error: error.message,
        fieldErrors: "fieldErrors" in error ? (error.fieldErrors as Record<string, string[]>) : undefined,
      };
    }
    console.error("[action] error inesperado", { requestId: session.ctx.meta.requestId, error });
    return {
      ok: false,
      error: `Ocurrió un error inesperado (ref. ${session.ctx.meta.requestId?.slice(0, 8)})`,
    };
  }
}
