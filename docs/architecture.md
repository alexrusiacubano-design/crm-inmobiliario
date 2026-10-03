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

## Operaciones, comisiones y rendimiento

- **Operación (`deal`).** Propiedad + cliente + precio. Etapas con transiciones en
  `canTransitionDeal`; cada cambio queda en `deal_stage_event` (append-only) y mueve el estado de
  la propiedad y del lead. Cerrar exige `deal.close`.
- **Honorarios.** Uno por parte (`deal_commission`); cobrar exige `commission.manage` y un cobro no
  se modifica. El reparto (`deal_participant`) suma 100 % y guarda el porcentaje del agente según
  su escalón al cerrar (`commission_tier`, configurable).
- **Dinero sin float.** Parte del agente = honorario × reparto × porcentaje, con `percentage()`
  (half-even). Los pesos se suman a la facturación en USD con el tipo de cambio de referencia.
- **Métricas y puntos** se calculan de lo registrado (agenda, propiedades, leads, etapas y cobros);
  no hay carga manual. Las reglas de puntos (`POINT_RULES`) se muestran en pantalla.

## Matching y comparables (Fase 4)

- **Reglas puras.** `scoreMatch` (`packages/shared/src/matching.ts`) decide si una propiedad sirve
  para una búsqueda y con qué puntaje (0–100). Excluyen: operación, estado ofrecible (disponible,
  publicada, en negociación), tipo, zona (barrio, localidad o departamento), precio más de 10 %
  arriba del máximo, dos dormitorios menos y mascotas en alquiler. El resto penaliza. Se sugiere
  desde 50 %. Los motivos se guardan con la sugerencia y se muestran al agente.
- **Monedas.** Precios y gastos comunes se convierten a la moneda de la búsqueda con el tipo de
  cambio de referencia de la organización, en enteros (sin float).
- **`property_match`.** Una fila por lead × propiedad con estado (sugerida, enviada, le interesa,
  descartada). Se recalcula al abrir la ficha del lead, la de la propiedad, el tablero de
  matching o el dashboard: las sugerencias que dejan de cumplir se borran si nadie las trabajó y
  quedan inactivas si ya se enviaron. Enviar y marcar interés quedan en el timeline del cliente.
- **Alcance.** El inventario es de toda la inmobiliaria; los leads se ven según `lead.read`.
  Cambiar el estado exige `lead.update` sobre el lead y `matching.run`.
- **Comparables.** `suggestComparables` busca en el inventario propio mismo tipo y operación, el
  mismo barrio (o la localidad si hay menos de 3) y ±35 % de metraje; prefiere precios de cierre
  reales (operaciones firmadas o cerradas) sobre precios publicados. Devuelve la mediana de precio
  por m², un valor sugerido y una confianza según la cantidad de muestras. El agente revisa y
  registra la tasación como siempre.

## Ofertas y reservas (Fase 6)

- **Dentro de la operación.** Las ofertas (`deal_offer`) y la reserva (`deal_reservation`) cuelgan
  de una operación; se gestionan con `offer.manage` / `reservation.manage` sobre su alcance.
- **Ofertas inmutables.** Monto, moneda y parte no se modifican ni se borran (trigger); una
  contraoferta es una fila nueva que apunta a la anterior, que queda "contraofertada". Solo una
  pendiente por operación (índice único parcial). Aceptar fija el precio de la operación y ajusta
  el honorario sugerido por la comisión pactada si seguía pendiente.
- **Reserva con seña.** Registrarla pasa la operación y la propiedad a Reservada. Guarda monto,
  quién tiene la seña (inmobiliaria, propietario, escribanía), recibo y vencimiento; se puede
  prorrogar. Una vigente por operación. Al avanzar a escribanía/garantía queda "convertida".
- **Baja con seña vigente.** No se vuelve atrás ni se cae la operación a mano: se cancela la
  reserva indicando si la seña se devuelve (con fecha) o se retiene, y si se sigue negociando o
  la operación se cae (libera la propiedad y anula honorarios pendientes).
- Todo queda en el timeline del cliente, la auditoría y eventos `offer.*` / `reservation.*`.

## Contratos de alquiler (Fase 7)

- **`rental_contract`.** Propiedad, inquilino, plazo (inicio + meses → fin), alquiler vigente, día
  de pago, ajuste (IPC, UI, % fijo o sin ajuste, cada N meses), depósito, garantía y comisión de
  administración (para liquidaciones). Un contrato vigente por propiedad (índice único parcial).
  Se crea suelto o desde una operación de alquiler firmada; la propiedad pasa a Alquilada.
- **Historial del alquiler** (`rental_contract_rent`, append-only): inicial, ajustes, acuerdos y
  renovaciones con el porcentaje aplicado. Los ajustes redondean a pesos enteros sin float y
  corren el próximo ajuste según la frecuencia (nunca después del fin).
- **Renovación:** el contrato queda "renovado" y nace uno nuevo encadenado desde el día siguiente
  al vencimiento, con las mismas partes y condiciones. **Finalizar / rescindir** (rescisión con
  motivo obligatorio) libera la propiedad.
- **Avisos:** vencimientos a 90 días y ajustes a 30 (incluye vencidos y atrasados) en la bandeja
  de renovaciones, el listado y el dashboard. Permisos `contract.read` / `contract.manage`.

## Garantías (Fase 8)

- **`rental_guarantee`.** Tipos de Uruguay: ANDA, CGN, Fondo de Garantía del MVOT, seguro de
  fianza, depósito (BHU, inmobiliaria, propietario) y garantía propietaria con fiador. Guarda
  entidad, n.º de póliza o certificado, cobertura, vigencia y una lista de requisitos que se
  copia del tipo y se puede ampliar.
- **Trámite:** en trámite → aprobada / rechazada (con motivo) → vigente → vencida o liberada.
  Pasar a vigente exige contrato vinculado y requisitos completos (también hay constraint en la
  base). Se puede iniciar desde la operación de alquiler, antes del contrato.
- **Con el contrato:** al renovar, las garantías pasan al contrato nuevo; al finalizar o
  rescindir, las vigentes quedan liberadas.
- **Avisos:** vencimiento a 60 días, trámite demorado (más de 15 días), requisitos pendientes,
  garantía que no cubre hasta el fin del contrato y contratos vigentes sin garantía.
