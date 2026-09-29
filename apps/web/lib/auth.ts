import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import { getDb, schema } from "@crm/db";
import { newId } from "@crm/db/schema";

const secret = process.env.BETTER_AUTH_SECRET;
/** Intentos de login por minuto y por IP. 5 por defecto; el E2E lo sube para poder loguearse varias veces. */
const signInMax = Number(process.env.AUTH_SIGNIN_MAX_PER_MINUTE ?? 5);
if (!secret && process.env.NODE_ENV === "production") {
  throw new Error("BETTER_AUTH_SECRET es obligatoria en producción");
}

/**
 * Autenticación: email + contraseña con sesiones en base de datos (cookies httpOnly),
 * 2FA TOTP opcional y rate limiting persistente. El registro público está deshabilitado:
 * los usuarios los crea un administrador.
 */
/** En Vercel se toma la URL del despliegue si no se configuró BETTER_AUTH_URL. */
const vercelUrl = (host?: string) => (host ? `https://${host}` : undefined);
const baseURL =
  process.env.BETTER_AUTH_URL ??
  vercelUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL) ??
  vercelUrl(process.env.VERCEL_URL);
const staticOrigins = [
  baseURL,
  vercelUrl(process.env.VERCEL_URL),
  vercelUrl(process.env.VERCEL_BRANCH_URL),
  vercelUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL),
].filter((o): o is string => Boolean(o));

/**
 * Orígenes aceptados para el login. En Vercel un mismo despliegue responde en varios
 * dominios (producción, rama, alias del team), así que además del configurado se acepta el
 * propio dominio de la petición: sigue bloqueando formularios enviados desde otros sitios.
 */
function trustedOrigins(request?: Request): string[] {
  if (!request || !process.env.VERCEL) return staticOrigins;
  try {
    return [...staticOrigins, new URL(request.url).origin];
  } catch {
    return staticOrigins;
  }
}

export const auth = betterAuth({
  appName: "Inmobiliaria CRM",
  secret,
  baseURL,
  trustedOrigins,
  database: drizzleAdapter(getDb(), {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
      twoFactor: schema.twoFactor,
      rateLimit: schema.rateLimit,
    },
  }),
  advanced: {
    database: { generateId: () => newId() },
    useSecureCookies: process.env.NODE_ENV === "production",
    cookiePrefix: "crm",
  },
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
  },
  session: {
    expiresIn: 60 * 60 * 12, // 12 h
    updateAge: 60 * 60, // renueva como máximo cada hora
    freshAge: 60 * 15,
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: signInMax },
      "/two-factor/verify-totp": { window: 60, max: 5 },
      "/two-factor/verify-backup-code": { window: 60, max: 5 },
    },
  },
  plugins: [twoFactor({ issuer: "Inmobiliaria CRM" }), nextCookies()],
});

export type Auth = typeof auth;
