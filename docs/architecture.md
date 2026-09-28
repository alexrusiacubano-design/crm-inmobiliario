# Arquitectura

Monolito modular en TypeScript. El documento de referencia completo (modelo de datos de todas
las fases, roadmap, riesgos) es "CRM Inmobiliario Uruguay — Fase 0: Auditoría y Arquitectura".

## Flujo de una escritura

```
Navegador ──► Server Action (apps/web)
                 │  getSessionContext(): sesión Better Auth → loadContext() → RequestContext
                 ▼
             Servicio de dominio (packages/core)
                 │  requirePermission(ctx, código, registro?)
                 │  parseInput(esquemaZod, entrada)          ← validación SIEMPRE en servidor
                 │  db.transaction(tx => {
                 │     cambio + writeAudit(tx) + emitEvent(tx)   ← atómico
                 │  })
                 ▼
             PostgreSQL ── domain_event (outbox) ──► apps/worker ──► handlers
```

## Reglas del núcleo

- **Contexto obligatorio.** Ningún servicio accede a datos sin `RequestContext`. El cliente nunca
  envía `organizationId`, `userId` ni permisos: se derivan de la sesión.
- **Multi-tenant.** Toda tabla de negocio lleva `organization_id`. Los servicios filtran por él y
  verifican que las referencias (roles, sucursales, equipos, miembros) pertenezcan a la misma
  organización. Row Level Security se agrega como segunda barrera en la Fase 14.
- **RBAC con alcance.** Un permiso es un código del catálogo
  (`packages/shared/src/rbac/permissions.ts`) más un alcance `own | team | branch | org`. Un rol
  asignado "solo en una sucursal" reduce `org` y `branch` a esa sucursal. `scopeCondition()`
  traduce los alcances a SQL para los listados.
- **Anti-escalada.** Nadie puede otorgar un permiso que no tiene ni con más alcance que el suyo.
  Solo un Super Admin toca el rol Super Admin y la organización nunca queda sin uno activo.
- **Auditoría inalterable.** `audit_log` se escribe en la misma transacción que el cambio y un
  trigger de Postgres rechaza UPDATE, DELETE y TRUNCATE. Los secretos se redactan.
- **Outbox.** `domain_event` es inmutable salvo las columnas de entrega. El worker usa
  `FOR UPDATE SKIP LOCKED`, reintenta hasta 8 veces y guarda el último error.
- **Dinero.** `Money { amountMinor: bigint; currency: "UYU" | "USD" }`. Reparto por mayor
  residuo (la suma siempre cierra), porcentajes en basis points con redondeo bancario.
- **Numeración.** `nextCode(tx, org, "PROP")` → `PROP-000001`, atómico y sin huecos.
- **Honestidad de la UI.** Los módulos no construidos muestran en qué fase llegan; no hay datos
  simulados ni botones sin backend.

## Seguridad de la Fase 1

Sesiones en base con cookies httpOnly (prefijo `crm`, `Secure` en producción), expiración de 12 h,
registro público deshabilitado, contraseñas de 10+ caracteres con hash scrypt, 2FA TOTP opcional
con códigos de respaldo, rate limiting persistente (login 5/min por IP, 2FA 5/min), protección
de rutas en `proxy.ts` + verificación real en cada página y acción, redirección post-login solo
a rutas internas, cabeceras de seguridad (HSTS, X-Frame-Options, nosniff, Referrer-Policy).
Suspender o cambiar la contraseña de un usuario cierra sus sesiones.
