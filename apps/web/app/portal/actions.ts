"use server";

import { activatePortalAccess, isAppError, sendOwnerMessage } from "@crm/core";
import { getDb } from "@crm/db";
import type { ActionResult } from "@/lib/actions";
import { getPortalSession } from "@/lib/session";

function fail(error: unknown): ActionResult<never> {
  if (isAppError(error))
    return {
      ok: false,
      error: error.message,
      fieldErrors: "fieldErrors" in error ? (error.fieldErrors as Record<string, string[]>) : undefined,
    };
  console.error("[portal] error", error);
  return { ok: false, error: "Ocurrió un error inesperado. Probá de nuevo." };
}

/** Activación de la invitación (sin sesión: autentica el token). */
export async function activatePortalAction(input: unknown): Promise<ActionResult<{ email: string }>> {
  try {
    return { ok: true, data: await activatePortalAccess(getDb(), input) };
  } catch (error) {
    return fail(error);
  }
}

export async function sendOwnerMessageAction(input: unknown): Promise<ActionResult<{ delivered: boolean }>> {
  const s = await getPortalSession();
  if (!s) return { ok: false, error: "Tu sesión expiró. Volvé a ingresar." };
  try {
    return { ok: true, data: await sendOwnerMessage(getDb(), s.pctx, input) };
  } catch (error) {
    return fail(error);
  }
}
