# Inmobiliaria CRM

CRM inmobiliario para Uruguay: ventas, alquileres, administración de alquileres, comisiones y reportes.
Se construye por fases. Hecho: **Fase 1 — Fundaciones** (usuarios, roles, sucursales, auditoría),
**Fase 2 — CRM** (contactos, leads, clientes, propietarios, duplicados, timeline y búsqueda global),
**Fase 3 — Propiedades** (inventario con código PROP, fotos y planos, precios con historial,
copropiedad, documentos con control de acceso, captaciones con exclusividad y tasaciones) y
**Fase 5 — Agenda y visitas** (calendario mes/semana/día/lista, visitas con resultado, agenda de hoy y
visitas sin cerrar en el dashboard, pestaña de agenda en fichas de contacto y propiedad), más
**Operaciones y comisiones** (etapas hasta la firma, honorarios por parte, cobros, reparto entre agentes,
finanzas del agente y plan de carrera con escalones configurables).

## Stack

| Capa          | Tecnología                                                           |
| ------------- | -------------------------------------------------------------------- |
| Monorepo      | pnpm workspaces + Turborepo                                          |
| Web           | Next.js 16 (App Router, Server Actions), React 19, TypeScript strict |
| UI            | Tailwind CSS 4, Radix UI, cmdk, sonner, next-themes                  |
| Base de datos | PostgreSQL 16 + Drizzle ORM (migraciones SQL versionadas)            |
| Autenticación | Better Auth (sesiones en DB, 2FA TOTP, rate limiting persistente)    |
| Validación    | Zod 4, esquemas compartidos cliente/servidor                         |
| Archivos      | Proveedor de almacenamiento: disco local (dev) o S3/R2; sharp        |
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
Las propiedades DEMO son 8 (publicadas, en borrador, reservada, con rebajas de precio y copropiedad),
con 6 captaciones en distintas etapas (una con exclusividad por vencer), tasaciones y documentos. Las
fotos son ilustraciones generadas con la leyenda "DEMO", no imágenes de inmuebles reales. La agenda DEMO
trae 8 eventos relativos a la fecha del seed (visitas de hoy, una visita de ayer sin cerrar, una
realizada con resultado, reuniones y recordatorios).

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

## Archivos

Fotos, planos y documentos nunca tienen URL pública: se sirven por `/api/media/:id` y
`/api/documents/:id`, que verifican sesión y permisos (y auditan cada descarga de documentos). El
tipo se valida por el contenido del archivo, no por la extensión; a las fotos se les quitan los
metadatos EXIF (incluida la ubicación GPS) y se generan miniaturas WebP.

- Desarrollo: `STORAGE_DRIVER=local` guarda en `.storage/` (raíz del repo, ignorada por git).
- Producción: `STORAGE_DRIVER=s3` con un bucket privado de S3, Cloudflare R2 o Supabase Storage
  (API S3). El disco local se rechaza en producción salvo `STORAGE_ALLOW_LOCAL=1`, porque en
  plataformas serverless los archivos se pierden.
