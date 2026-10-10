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

## Cobros y liquidaciones (Fase 9)

- **Cuotas (`rent_charge`)**: una por contrato y mes, con vencimiento en el día de pago. Se
  generan por período (idempotente) con el alquiler vigente según el historial y prorrateo por
  días si el contrato empieza o termina dentro del mes. Conceptos (`rent_charge_line`,
  append-only): alquiler, gastos comunes, contribución, recargo por mora, bonificación (resta).
- **Pagos (`rent_payment`, append-only)**: parciales permitidos, nunca por encima del saldo.
  Anular es un contra-asiento negativo que referencia al original (una sola vez, con motivo, y
  solo si la cuota no está liquidada). Estado de la cuota: pendiente, parcial, pagada o vencida.
- **Liquidación (`owner_settlement`)**: cobrado − comisión de administración (solo sobre la parte
  de alquiler cobrada) − descuentos detallados = neto, repartido entre propietarios por
  participación con `allocate` (la suma da exacto). Borrador → aprobada → pagada (fecha y
  referencia) o anulada con motivo; una vigente por cuota. CHECK en la base: neto = cobrado −
  comisión − descuentos.
- Permisos: `rent.read/manage`, `payment.register`, `payment.void`, `settlement.read/manage`.
  La facturación electrónica (CFE) sigue pendiente: requiere un proveedor habilitado por DGI.

## Comunicaciones (Fase 10)

- **Bandeja de consultas (`inquiry`)**: entran por el sitio, portales o el asistente con
  `POST /api/inquiries?org=<slug>` (header `x-crm-key` = `INQUIRY_WEBHOOK_SECRET`, comparación en
  tiempo constante, idempotente por `externalRef`) o se cargan a mano. Si el teléfono o email ya
  existe se vincula el contacto. Abierta → tomada (o asignada por quien tiene `lead.assign`) →
  resuelta / descartada con motivo; "Crear lead" la convierte reutilizando el contacto. Las sin
  tomar las ve todo el que tiene `communication.read`; las tomadas, según su alcance. Aviso si
  pasa más de una hora sin tomar. Recepción suma `communication.send` y `lead.assign`.
- **Chat interno**: directos (sin duplicar, clave ordenada) y grupos con nombre; mensajes
  append-only; solo los ven los participantes. Se actualiza cada 4 s por consulta (sin
  websockets, funciona en Vercel). No leídos por conversación y en el dashboard.
- **Plantillas (`message_template`)**: WhatsApp y email con variables ({{nombre}}, {{propiedad}},
  {{precio}}…) validadas al guardar; se cargan cuatro sugeridas. El compositor completa las
  variables, abre `wa.me` o `mailto:` con el texto y registra lo enviado en el timeline (y marca
  el lead como contactado). El envío automático requiere WhatsApp Business Platform / un
  proveedor de email.

## Publicaciones e integraciones (Fase 11)

- **Cuentas de portal (`portal_account`)**: una por portal (InfoCasas, Mercado Libre Inmuebles,
  Gallito, sitio web propio, otro) con activo/inactivo, código de cliente, cupos por nivel
  (Básico, Plata, Oro, Premium; vacío = sin límite) y un token secreto de feed. El sitio web
  arranca activo. Solo quien tiene `integrations.manage` ve y regenera el token.
- **Avisos (`property_publication`)**: uno por propiedad y portal. Publicar requiere
  `publication.manage` (dirección a nivel organización, gerencia a nivel sucursal; los agentes
  no publican), checklist completo, propiedad disponible / publicada / en negociación, portal
  activo y cupo libre en el nivel. Publicar deja la propiedad en "Publicada". Publicado ↔
  pausado → vencido / dado de baja. Sincronización automática con el estado de la propiedad:
  reservada / pausada / borrador → avisos pausados; vendida / alquilada / retirada → baja.
  Alertas: vence en ≤ 7 días, vencido, propiedad no disponible, sin enlace.
- **Feed XML** `GET /api/feeds/<token>` (sin sesión, autentica el token) con los avisos
  publicados de ese portal: precios, ubicación aproximada (3 decimales), características y
  fotos (`/api/feeds/<token>/media/<id>`, solo fotos de avisos publicados). Cada portal mapea el
  feed a su formato; los conectores específicos por API quedan para cuando haya credenciales.
- **Tipo de cambio (`exchange_rate`)**: dólar billete por fecha, manual o traído del web
  service SOAP del BCU (código 2225, últimos 7 días). La cotización de fecha más reciente pasa a
  `commission_settings.uyu_per_usd`, que usan el matching, las tasaciones y los reportes.
- **Padrón y ubicación**: `property.padron`; las captaciones guardan padrón, coordenadas
  (selector de mapa Leaflet/OSM), portal de origen y URL del aviso, y los heredan al crear la
  propiedad.

## Automatizaciones, notificaciones y asistente virtual (Fase 12)

- **Reglas (`automation_rule`)**: disparador → condiciones (Y) → acciones. Disparadores por
  evento del outbox (lead nuevo / asignado / cambia de estado, consulta, operación iniciada,
  oferta, oferta aceptada, reserva, cierre, caída, contrato, cambio de estado de propiedad) y
  programados (lead sin contacto, cuota vencida, contrato por vencer, reserva por vencer, aviso
  por vencer, con N días). Condiciones sobre un catálogo de campos por entidad. Acciones:
  notificación (al responsable, a un rol o a un usuario), tarea en la agenda, asignación en rueda
  (leads), etiqueta al contacto y webhook HTTPS firmado (`X-CRM-Signature`, HMAC-SHA256; se
  bloquean IPs privadas y localhost). Textos con variables `{{codigo}}`, `{{nombre}}`…
- Las acciones se ejecutan con los permisos de quien guardó la regla por última vez. Lo que hace
  una automatización marca sus eventos (`_automation`) y no dispara otras: sin cadenas ni bucles.
  Una regla nueva no actúa sobre eventos anteriores a su creación; la migración 0017 da por
  entregados los eventos acumulados.
- **Historial (`automation_run`)** con `dedupe_key` único por regla (evento, o entidad + fecha
  relevante en los programados): nada se ejecuta dos veces. Estado ejecutada / parcial / falló
  con el detalle de cada acción.
- **Ejecución**: en Vercel no hay worker permanente, así que los eventos se entregan con
  `after()` al final de cada server action y los programados corren como mucho una vez por hora
  por organización al navegar (`automation_schedule`, marca tomada con UPDATE condicional).
  También: el worker (`apps/worker`, eventos continuos y programados cada hora) y
  `GET /api/cron/automations` con `Authorization: Bearer <CRON_SECRET>` para un cron externo.
- **Notificaciones (`notification`)**: campanita con contador (se actualiza cada minuto), últimas
  ocho y página `/notifications`. Cada usuario ve y marca solo las suyas.
- **Asistente virtual (`bot_settings`)**: chat público `/chat/<token>` insertable con
  `<script src="/api/bot/<token>/widget">` (botón flotante + iframe; `/chat` admite
  `frame-ancestors *`). Responde preguntas frecuentes por palabras clave (sin tildes, por
  prefijo), reconoce códigos «PROP-12», busca entre las propiedades publicadas en el sitio web
  propio (precio máximo con conversión por el tipo de cambio) y deriva a la bandeja como consulta
  de canal «bot» con la conversación. Sin IA externa. Límite por IP en el endpoint.

## Reportes (Fase 13)

- `/finance/reports` con permiso `report.read`; cada consulta aplica el alcance del permiso
  (equipo para supervisores, sucursal para gerencia, organización para dirección) y los filtros
  opcionales de sucursal y agente. Períodos: semana, mes, trimestre, año o rango (máx. 2 años).
- **Comercial**: leads del período, % contactados, mediana de primera respuesta, conversión,
  embudo por la etapa más avanzada que alcanzó cada lead (según su historial de estados: un lead
  perdido después de visitar cuenta en "Visita"), por origen, por agente, motivos de pérdida y
  leads por mes (12 meses).
- **Operaciones y honorarios**: cierres del período (ventas / alquileres), volumen por moneda,
  honorarios pendientes y cobrados, mediana de días para cerrar y de días en el mercado, caídas
  con motivo, ranking por agente en dólares (pesos al tipo de cambio de referencia) y cierres por
  mes.
- **Alquileres**: contratos vigentes, nuevos y por vencer, facturado y cobrado en el período (tasa
  de cobranza por moneda), morosidad actual y liquidaciones pagadas.
- **Inventario**: foto actual por estado y tipo, antigüedad promedio, bajas de precio del período
  y propiedades con más de 90 días.
- Exportación CSV (separador ";", BOM UTF-8, protección contra fórmulas) por tabla en
  `/api/reports/export`, con la sesión y el alcance de quien la pide.

## Portal del propietario y RLS (Fase 14)

- **Acceso (`owner_portal_access`)**: desde la ficha del contacto (pestaña Propietario) quien
  tiene `owner.update` sobre ese contacto genera una invitación de 7 días. El token se muestra una
  sola vez (se guarda su SHA-256) y se envía por WhatsApp o email. Al activarlo el propietario
  elige su contraseña y se crea su usuario de Better Auth **sin membresía**: nunca entra al CRM
  (cualquier ruta del CRM lo redirige a `/portal` y las server actions lo rechazan). Quitar el
  acceso cierra sus sesiones.
- **Portal (`/portal`)**: solo lectura de las propiedades donde figura como propietario —
  precios, fotos, avisos (vistas y contactos), visitas con su devolución (sin datos del
  visitante), ofertas recibidas, contrato vigente, cuotas del inquilino y sus liquidaciones
  aprobadas o pagadas con **su parte** según el reparto. Puede escribirle a su agente: queda en el
  timeline del contacto y le llega una notificación.
- **RLS**: la migración 0018 activa Row Level Security en todas las tablas del esquema público y
  revoca los permisos de los roles `anon` y `authenticated` de Supabase, así la API REST pública
  de Supabase no expone datos aunque se filtre la clave pública. La aplicación usa el rol dueño
  de las tablas (no sujeto a RLS) y aplica los permisos en el servidor; cada corrida de
  migraciones vuelve a activar RLS en las tablas nuevas.

## Documentos imprimibles y envío de emails (Fase 15)

- **Documentos** (`/print/...`, hoja A4 que se imprime o guarda como PDF desde el navegador, sin
  librerías ni servicios externos): liquidación al propietario, recibo / estado de cuenta de una
  cuota con conceptos y pagos (los anulados no figuran), y ficha comercial de la propiedad para
  clientes (sin dirección exacta, propietarios ni datos internos). El propietario descarga sus
  liquidaciones desde el portal (`/portal/imprimir/<código>`, solo su parte). Configuración suma
  razón social, RUT, dirección, teléfono, email y web, que encabezan los documentos. Ninguno es un
  comprobante fiscal (CFE).
- **Email** con Resend (API HTTP): se activa con `RESEND_API_KEY` y `EMAIL_FROM` (dominio
  verificado). Habilita "Enviar desde el CRM" en el compositor (respuesta al email del agente,
  queda en el timeline), el envío automático de la invitación al portal y la acción de
  automatización "Enviar email al cliente" (por ejemplo, recordatorio de pago). Sin esas variables
  todo sigue funcionando con el correo del usuario (`mailto:`).

## Facturación de honorarios (Fase 16)

- `/finance/invoicing` (`invoice.read` / `invoice.manage`: administración y contabilidad).
- **Por facturar**: honorarios de operaciones firmadas o cobradas (`deal_commission`) y comisiones
  de administración de liquidaciones aprobadas o pagadas (`owner_settlement.fee`) que todavía no
  están en una factura vigente. Sugiere el receptor (comprador / inquilino o el propietario
  principal) con su documento si el usuario puede ver identidades.
- **Factura (`invoice` + `invoice_line`)**: numeración interna FAC-000001, receptor con RUT
  (e-Factura, RUT validado con dígito verificador) o cédula (e-Ticket), IVA básico 22 % sumado o
  incluido (cálculo en bigint, total = neto + IVA exacto, con CHECK en la base). Un concepto no se
  factura dos veces (índice único sobre la fuente en líneas vigentes).
- **Emisión**: el CFE se emite en el portal de DGI o el sistema actual y se carga serie, número y
  fecha (único por tipo de CFE). Un trigger impide modificar una emitida; se anula con motivo (la
  fuente vuelve a quedar para facturar; la nota de crédito se emite en DGI). Los borradores se
  borran. Proforma / comprobante imprimible en `/print/factura/<id>`.
- La emisión automática se suma conectando un proveedor habilitado por DGI cuando se elija.

## Credenciales de portales y Mercado Libre (Fase 17)

- Cada portal tiene su tarjeta en Integraciones con "Conexión automática": los datos que pide el
  portal (`PORTAL_CREDENTIAL_FIELDS`) se cargan desde la pantalla y se guardan cifrados con
  AES-256-GCM (`FIELD_ENCRYPTION_KEY`) en `portal_account.credentials_encrypted`. La pantalla solo
  ve `credential_hints` (valores no secretos y secretos enmascarados "••••abcd"); un secreto vacío
  conserva el guardado; la auditoría registra qué campos cambiaron, nunca los valores. Ningún
  listado devuelve los campos cifrados.
- **Mercado Libre**: App ID y Secret Key de la aplicación propia (developers.mercadolibre.com.uy,
  con la URL de redirección `/api/integrations/mercadolibre/callback`) y botón "Conectar"
  (OAuth 2 con PKCE; el `state` va cifrado y vence a los 15 minutos; solo lo completa quien lo
  inició). Tokens cifrados en `tokens_encrypted`; se renuevan solos bloqueando la fila (el refresh
  token de ML es de un solo uso).
- **Publicación**: al publicar en Mercado Libre desde la ficha se crea el aviso por la API
  (categoría sugerida por `domain_discovery`, tipo de publicación según el nivel, fotos desde el
  feed del portal, atributos de inmueble, ubicación aproximada). Pausar, volver a publicar, dar de
  baja o cambiar el precio se refleja allá; los cambios de estado de la propiedad (reservada,
  vendida) se sincronizan en segundo plano y se traen las visitas. Un error del portal no rompe:
  queda en la publicación (`sync_error`) y se muestra.
- InfoCasas, Gallito y "otro" guardan sus credenciales; la publicación por API se conecta cuando
  el portal entregue la documentación (mientras tanto, feed XML).

## Sitio web público (catálogo)

- `/propiedades` (listado con filtros por operación, tipo, zona, dormitorios y precio) y
  `/propiedades/[codigo]` (ficha con galería, detalles, ubicación aproximada, formulario y WhatsApp).
  `/` lleva al catálogo si no hay sesión y al dashboard si la hay.
- Solo muestra lo publicado en el portal **Sitio web propio** (`packages/core/src/catalog/catalog.ts`,
  sobre `feedListings`). Nunca expone dirección, unidad, padrón ni datos internos; la ubicación se
  redondea a ~200 m.
- Inmobiliaria del sitio: `SITE_ORG_SLUG` o, si no está, la única organización real.
- Fotos públicas en `/api/sitio/foto/[id]` (solo si pertenecen a un aviso activo). Consultas en
  `POST /api/sitio/consulta` → `ingestInquiry` canal `web`, con límite por IP y campo trampa.
- Incluye el asistente virtual si está activo. Tipografía Cormorant Garamond (OFL) servida localmente.

## Tasaciones independientes

- Sección **Tasaciones** (Nueva tasación, Comparador, Historial): tabla `appraisal` (código TAS),
  sin necesidad de una propiedad del CRM (`propertyId`/`acquisitionId` quedan para vincular luego).
- Método de comparables homogeneizados (`packages/shared/src/appraisal.ts`): valor por m² de cada
  antecedente × factores de construcción y ubicación respecto del inmueble (1,15 · 1,07 · 1 · 0,93 ·
  0,87) × descuento de negociación para ofertas (7 % por defecto). Valor = promedio × m² de cálculo
  (edificados o, si no hay, totales), rango ± desvío con mínimo ±5 %, redondeo a 100 U$S / 1.000 $.
  El servidor recalcula siempre; el tasador puede fijar un valor adoptado.
- Comparador: US$/m² de propiedades publicadas (oferta) y operaciones cerradas (real) del CRM,
  respetando el alcance de `property.read`; los casos marcados se pasan a una nueva tasación.
- Informe imprimible en `/print/tasacion/[id]`.

## Clientes que ofrecen, ficha de propiedad y reservas

- Operaciones del lead: buscan (`buy`, `rent`, `temporary_rent`, participan del matching) u ofrecen
  (`sell`, `rent_out`, `temporary_rent_out`, posible captación con botón para crearla prefijada).
- Ficha de propiedad: galería y panel lateral con todos los datos, edición en el mismo panel (usa
  `updateProperty`), exclusividad `property.exclusive`/`exclusive_until` (`setPropertyExclusivity`;
  se hereda de la captación al crear la propiedad), mapa, video y portales.
- Reservas: la seña es opcional (monto 0 = sin seña; CHECK `deposit_minor >= 0`); además firma
  pactada, fechas de boleto, operación compartida, escribanos de cada parte y `updateReservation`.
