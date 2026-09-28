import type { EventHandler } from "@crm/core";

/**
 * Registro de manejadores por tipo de evento. En la Fase 1 no hay consumidores: los eventos
 * se marcan como entregados. Las automatizaciones (Fase 12), el matching en lote (Fase 4) y
 * la búsqueda global (Fase 2) se registrarán aquí.
 */
export const handlers = new Map<string, readonly EventHandler[]>();
