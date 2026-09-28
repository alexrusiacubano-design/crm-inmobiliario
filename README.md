# Inmobiliaria CRM

CRM inmobiliario para Uruguay: ventas, alquileres, administración de alquileres, comisiones y reportes.
Se construye por fases. Hecho: **Fase 1 — Fundaciones** (usuarios, roles, sucursales, auditoría) y
**Fase 2 — CRM** (contactos, leads, clientes, propietarios, duplicados, timeline y búsqueda global).

## Stack

| Capa          | Tecnología                                                           |
| ------------- | -------------------------------------------------------------------- |
| Monorepo      | pnpm workspaces + Turborepo                                          |
| Web           | Next.js 16 (App Router, Server Actions), React 19, TypeScript strict |
| UI            | Tailwind CSS 4, Radix UI, cmdk, sonner, next-themes                  |
| Base de datos | PostgreSQL 16 + Drizzle ORM (migraciones SQL versionadas)            |
| Autenticación | Better Auth (sesiones en DB, 2FA TOTP, rate limiting persistente)    |
| Validación    | Zod 4, esquemas compartidos cliente/servidor                         |
| Tests         | Vitest (unitarios + integración con Postgres real), Playwright (E2E) |

## Estructura

```
apps/web          Next.js: páginas, server actions, layout, auth
apps/worker       Entrega de eventos del outbox (automatizaciones en fases futuras)
packages/shared   Código puro: dinero, catálogo de permisos, roles de sistema, esquemas Zod
packages/db       Esquema Drizzle, migraciones, seed (geografía UY + organización DEMO)
packages/core     Servicios de dominio: permisos, auditoría, eventos, secuencias, administración
docs/             Arquitectura y decisiones (ADR)
```

## Puesta en marcha

Requisitos: Node 22+, pnpm 10, Docker (o un PostgreSQL 16 propio).

```bash
pnpm install
cp .env.example .env                       # y también apps/web/.env.local con las mismas variables
docker compose up -d                       # Postgres con crm_dev y crm_test
pnpm db:migrate
pnpm db:seed                               # geografía UY + organización DEMO + CRM DEMO
pnpm dev                                   # web en http://localhost:3000
pnpm --filter @crm/worker dev              # worker (otra terminal)
```

Usuarios DEMO (contraseña = `DEMO_PASSWORD`, por defecto `Demo-2026!`):

| Email                           | Rol                           |
| ------------------------------- | ----------------------------- |
| superadmin@demo.example.com     | Super Admin                   |
| admin@demo.example.com          | Administrador                 |
| director@demo.example.com       | Director                      |
| gerente@demo.example.com        | Gerente (limitado a Carrasco) |
| supervisor@demo.example.com     | Supervisor (Ventas Pocitos)   |
| agente@demo.example.com         | Agente (Ventas Pocitos)       |
| agente2@demo.example.com        | Agente (Punta del Este)       |
| administracion@demo.example.com | Administración de alquileres  |
| contabilidad@demo.example.com   | Contabilidad                  |
| recepcion@demo.example.com      | Recepción                     |

El CRM DEMO trae 15 leads en todas las etapas del embudo, 4 propietarios (con cuenta bancaria si
`FIELD_ENCRYPTION_KEY` está configurada) y 2 pares de posibles duplicados para probar la fusión.

Todo lo sembrado está marcado como DEMO (`organization.is_demo`, nombres con "(DEMO)", dominio
reservado `example.com`). El seed se niega a correr con `NODE_ENV=production`.

## Comandos de calidad

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm test:e2e      # requiere la base DEMO sembrada
```

`pnpm test` usa `TEST_DATABASE_URL` (una base cuyo nombre termina en `_test`; se recrea sola).

## Variables de entorno

Ver `.env.example`. Nunca se exponen secretos al navegador: solo el código de servidor lee
`DATABASE_URL` y `BETTER_AUTH_SECRET`. `AUTH_SIGNIN_MAX_PER_MINUTE` (por defecto 5) limita los
intentos de login por IP.
