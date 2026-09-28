# ADR 0001 — Stack y desvíos respecto de la Fase 0

Fecha: 2026-09-27 · Estado: aceptada

## Decisión

Next.js + PostgreSQL + Better Auth en un monorepo pnpm/Turborepo, con los defaults de la Fase 0:
Supabase solo como Postgres + Storage, despliegue Vercel (web) + Railway (worker), una
organización con modelo multi-tenant, UI en español con i18n.

## Desvíos respecto del documento de Fase 0

1. **Drizzle ORM en lugar de Prisma.** Prisma necesita descargar binarios propios al generar el
   cliente y al migrar; en el entorno donde se construyó la Fase 1 esa descarga está bloqueada y
   no se podía verificar nada. Drizzle es JavaScript puro, tipado igual de fuerte, y permite
   escribir en la migración lo que Prisma no modela bien: triggers append-only, índices parciales
   y `NULLS NOT DISTINCT`. Consecuencia: las migraciones viven en `packages/db/migrations` (SQL).
2. **Paquete `packages/shared` en lugar de `packages/validation` + `packages/config`.** El
   catálogo de permisos, los roles de sistema, el dinero y los esquemas Zod son código puro que
   necesitan tanto el seed (`db`) como los servicios (`core`) y el navegador. Juntarlos evita una
   dependencia circular `db ↔ core`. La configuración compartida quedó en la raíz.
3. **Worker sin pg-boss por ahora.** En la Fase 1 solo hay que entregar eventos del outbox; un
   sondeo con `FOR UPDATE SKIP LOCKED` alcanza. pg-boss entra cuando haya jobs programados
   (alertas de vencimiento, cobros mensuales).
4. **Rate limiting solo en autenticación.** Las server actions están detrás de sesión y permisos;
   el rate limiting general por usuario queda para la Fase 14.
