import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  UnauthenticatedError,
  loadContext,
  loadPortalContext,
  requirePermission,
  type RequestContext,
} from "@crm/core";
import { getDb } from "@crm/db";
import type { PermissionCode } from "@crm/shared/rbac";
import { auth } from "./auth";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  twoFactorEnabled: boolean;
}

/**
 * Resuelve la sesión y el contexto de permisos UNA vez por request (React cache).
 * Es la única puerta de entrada de identidad para páginas y server actions.
 */
export const getSessionContext = cache(
  async (): Promise<{ ctx: RequestContext; user: SessionUser } | null> => {
    const h = await headers();
    const session = await auth.api.getSession({ headers: h });
    if (!session) return null;
    try {
      const ctx = await loadContext(getDb(), {
        userId: session.user.id,
        meta: {
          ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
          userAgent: h.get("user-agent"),
          requestId: h.get("x-request-id") ?? crypto.randomUUID(),
        },
      });
      return {
        ctx,
        user: {
          id: session.user.id,
          name: session.user.name,
          email: session.user.email,
          twoFactorEnabled: Boolean((session.user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled),
        },
      };
    } catch (error) {
      if (error instanceof UnauthenticatedError) return null;
      throw error;
    }
  },
);

/** Para páginas: redirige al login si no hay sesión válida. */
export async function requireSession() {
  const result = await getSessionContext();
  if (!result) redirect((await getPortalSession()) ? "/portal" : "/login");
  return result;
}

/** Para páginas: además exige un permiso; si falta, muestra la página de acceso denegado. */
export async function requirePagePermission(code: PermissionCode) {
  const result = await requireSession();
  try {
    requirePermission(result.ctx, code);
  } catch {
    redirect("/forbidden");
  }
  return result;
}

/** Propietario con acceso al portal (usuario sin membresía en la organización). */
export const getPortalSession = cache(async () => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const pctx = await loadPortalContext(getDb(), session.user.id);
  return pctx
    ? { pctx, user: { id: session.user.id, name: session.user.name, email: session.user.email } }
    : null;
});

export async function requirePortalSession() {
  const s = await getPortalSession();
  if (!s) redirect("/login");
  return s;
}
