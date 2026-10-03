import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Protección de rutas optimista: sin cookie de sesión, redirige al login antes de renderizar.
 * La validación real (sesión vigente, membresía activa, permisos) ocurre en el servidor en
 * cada página y server action; esto solo evita renders innecesarios.
 */
// /api/inquiries se autentica con su propio secreto (webhook de consultas).
const PUBLIC_PATHS = ["/login", "/api/auth", "/api/inquiries", "/api/feeds"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();

  const cookie = getSessionCookie(request, { cookiePrefix: "crm" });
  if (!cookie) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname && pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
