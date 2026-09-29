# Referencia funcional: Imperium CRM

Relevamiento del CRM que usa hoy la inmobiliaria (vista de un agente, 28/09/2026), para tomarlo
como referencia de funciones. Se copian **funciones y flujos**, no la marca, textos, logos ni
datos: no se extrajo ningún dato de clientes. El diseño, los nombres y el código son propios.

Leyenda: ✅ ya existe en el repo · 🟡 existe parcial · 🔜 fase del roadmap donde entra.

## Navegación de Imperium

| Grupo         | Módulo             | Qué hace                                                                                                                                                                          | En nuestro CRM                                                                               |
| ------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| —             | Dashboard          | Saludo con fecha, KPIs (agenda, recordatorios, captaciones), agenda de hoy, visitas sin cerrar, nuevos ingresos, accesos rápidos                                                  | 🟡 rehecho en esta entrega (ver abajo)                                                       |
| Gestión       | Clientes           | Lista/kanban (Activo · Cerrado · Descartado), filtros estado/fuente/tipo, etiquetas, fuente (whatsapp, manual, web, bot)                                                          | ✅ F2 + tablero Activo/Cerrado/Descartado, fuente, WhatsApp                                  |
| Gestión       | Ficha de cliente   | Pestañas Resumen · Notas · Eventos · Oportunidad · Recordatorios · Propiedades · Pedidos; agente a cargo; próximas acciones; fechas importantes; vínculos; portal del propietario | ✅ próximas acciones, historial, fechas importantes, vínculos, agenda, propiedades sugeridas (F4); portal 🔜 F14         |
| Gestión       | Propiedades        | Inventario corporativo en grilla/lista, filtros estado, operación, tipo, dormitorios, departamento, barrio; nivel del aviso (Plata…)                                              | ✅ F3; nivel de aviso 🔜 F11                                                                 |
| Gestión       | Captaciones        | Kanban Llamando → Pre-captación → Tasando → Listo, filtro venta/alquiler, alta con portal de origen, padrón, mapa, propietario, URL del aviso                                     | ✅ F3 (etapas propias); padrón/mapa 🔜 F11                                                   |
| Gestión       | Mis Operaciones    | Operaciones en escribanía: Pendientes/Cerradas, filtro alquiler/venta, comprador, estado "En validación escribanía"                                                               | ✅ Operaciones + ofertas/contraofertas y reservas con seña (F6)                             |
| Gestión       | Tasaciones         | Tasación automática con comparables; KPIs total/completadas/borradores/valor mediano; confianza                                                                                   | ✅ F3 + F4: comparables automáticos del inventario (mediana m², cierres reales, confianza)   |
| Gestión       | Calendario         | Mes/Semana/Día/Lista; tipos Visita, Reunión, Llamada, Recordatorio, Otro                                                                                                          | ✅ F5                                                                                        |
| Integraciones | Agente virtual     | Consultas que el bot no resolvió: Abiertas/Pendientes/Tomadas/Resueltas/Rechazadas                                                                                                | 🔜 F10 (bandeja de consultas) + F12 (bot)                                                    |
| Integraciones | Marketplace        | Tienda interna de créditos para IA y planes                                                                                                                                       | Fuera de alcance (no aplica a una sola inmobiliaria)                                         |
| Comunidad     | Mensajes           | Chat interno 1-a-1 y grupos en tiempo real                                                                                                                                        | 🔜 F10                                                                                       |
| Comunidad     | Novedades          | Noticias de la oficina / corporativas, leído/no leído                                                                                                                             | 🔜 F15 (opcional)                                                                            |
| Mi espacio    | Finanzas           | Cobrado USD/UYU, cobrado del mes y del año, pendiente, próxima cobranza, gráfico mensual, comisiones por operación ("trabajada en equipo", "cobrás de ambas partes")              | ✅ Finanzas: cobrado, pendiente, próxima cobranza, gráfico mensual, comisiones por operación |
| Mi espacio    | Wallet             | Saldo UYU/USD, movimientos, retiros, conversión con tipo de cambio BCU                                                                                                            | 🔜 F9 (liquidación a agentes); tipo de cambio BCU F11                                        |
| Mi espacio    | Mi Carrera         | Escalones por facturación acumulada con % de comisión (40 → 45 → 50 → 55 → 60 %)                                                                                                  | ✅ Mi carrera con escalones configurables                                                    |
| Mi espacio    | Academy            | Cursos internos con aprobación                                                                                                                                                    | 🔜 F15 (opcional)                                                                            |
| Reporte       | Métricas del parte | Actividad semanal vs meta individual: presentaciones, captaciones, reservas, boletos, alquileres captados/señados/firmados, high ticket, facturación proyectada                   | ✅ actividad vs metas (general e individual), período anterior, facturación                  |
| Análisis      | Mapa de cierre     | Mapa de operaciones vendidas/alquiladas/reservadas, heatmap, padrones                                                                                                             | ✅ mapa OpenStreetMap de vendidas/alquiladas/reservadas + mis activas                        |
| Análisis      | Competencia        | Ranking por puntos de agentes y oficinas por temporada                                                                                                                            | ✅ ranking por puntos (reglas visibles) de agentes y sucursales                              |
| Soporte       | Ayuda              | Documentación, asistente IA, tickets                                                                                                                                              | 🔜 F15                                                                                       |

## Más allá de Imperium

- Contratos de alquiler (F7): plazos, ajustes IPC/UI/fijo, renovaciones encadenadas, rescisiones y avisos.

## Dashboard del agente (lo que se construyó en esta entrega)

Bloques de Imperium y cómo quedan en el nuestro, con datos reales y sin inventar nada:

1. **Saludo** con fecha larga en español y 3 contadores (captaciones abiertas, propiedades activas, leads sin atender).
2. **KPIs**: leads nuevos, sin atender, clientes abiertos, propiedades activas, exclusividades por vencer.
3. **Agenda de hoy / visitas sin cerrar**: eventos del día del usuario y visitas pasadas sin resultado (Fase 5, se cierran desde el mismo dashboard).
4. **Pipeline de captaciones** por etapa (reemplaza el kanban resumido de Imperium).
5. **Nuevos ingresos**: últimas 6 propiedades con portada, operación, precio, dormitorios, baños y m².
6. **Accesos rápidos**: Clientes, Propiedades, Captaciones, Tasaciones, Agenda, Comisiones.
7. **Exclusividades por vencer** (no existe en Imperium; lo mantenemos).

## Pendientes a decidir para próximas fases

- Etapas de captación: ¿adoptamos las de Imperium (Llamando, Pre-captación, Tasando, Listo) o mantenemos las actuales (Prospecto → Publicado)?
- Estados del cliente: Imperium usa solo Activo/Cerrado/Descartado; el nuestro tiene embudo de 8 etapas.
- Escalones de comisión (Mi Carrera) y metas del parte: definir montos y metas reales de la inmobiliaria.
