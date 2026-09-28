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

## Propiedades y archivos (Fase 3)

- **Inventario visible, edición acotada.** Todo agente ve el inventario completo (`property.read`
  con alcance organización, necesario para ofrecer y hacer matching), pero solo edita las
  propiedades de las que es responsable. Asignar a otro requiere alcance mayor a "propios".
- **Precios.** Un precio por operación (venta, alquiler, temporario) en unidad menor `bigint`.
  Cada cambio de cada campo (publicado, pedido del propietario, mínimo autorizado) queda en
  `property_price_history`, protegida por un trigger append-only. El mínimo autorizado solo lo
  ven y cambian quienes tienen `property.price.floor.read`; si otro usuario lo envía, se ignora.
  Una rebaja del precio publicado emite `property.price_reduced` (lo usará el matching).
- **Publicación con checklist.** No se publica sin título, descripción, localidad, precio por
  operación, 3 fotos, portada y propietarios que sumen 100 %. Publicar mueve la captación
  vinculada a "Publicado".
- **Copropiedad.** Participaciones en basis points (10000 = 100 %). Quien no puede ver la ficha
  de un propietario ve "Propietario (restringido)" y no recibe su identidad por ninguna vía.
- **Captaciones.** "Captado" exige la autorización de publicación firmada y crea, en la misma
  transacción, la propiedad en borrador con el propietario al 100 %, la comisión y los precios.
  Las tasaciones son inmutables (trigger append-only): una nueva reemplaza a la anterior.
- **Archivos.** `StorageProvider` (disco local o S3 compatible) con claves no adivinables por
  organización. Sin URLs públicas: rutas de la app con sesión y permisos. Tipo verificado por
  magic bytes; imágenes re-codificadas a WebP sin EXIF; si falla la base, se borran los archivos
  subidos. Los documentos tienen visibilidad interna, restringida (responsable y supervisores) o
  confidencial (`document.sensitive.read`); la baja es lógica y cada descarga se audita.

## Agenda y visitas (Fase 5)

- **Un solo modelo.** `calendar_event` guarda visitas, reuniones, llamadas, recordatorios y tareas.
  Las visitas se gobiernan con `visit.read/visit.manage` y el resto con `calendar.read/task.manage`;
  el alcance lo define el responsable (`assigned_user_id`), del que se heredan sucursal y equipo.
- **Agendar para otro** exige el permiso con alcance sobre el responsable resultante (recepción
  agenda visitas para cualquiera; un agente solo para sí).
- **Vínculos validados.** Contacto, lead y propiedad deben ser de la organización y visibles para
  quien agenda; si llega un lead se toma su contacto.
- **Cierre.** Realizado, cancelado o "no se presentó". Una visita realizada exige resultado
  (interesado, segunda visita, intención de oferta, no le interesó) y puede llevar un puntaje 1–5;
  el cierre queda en el timeline del contacto y emite `visit.completed` para métricas futuras.
  Constraints en la base: fin ≥ inicio, puntaje 1–5, `closed_at` coherente con el estado y
  resultado solo en visitas.
- **Zona horaria.** Los días se calculan en la zona de la organización (`organization.timezone`),
  tanto en SQL (agenda de hoy) como en la UI (`apps/web/lib/tz.ts`).
