import { automationHandlers } from "@crm/core";

/**
 * Registro de manejadores por tipo de evento. Las automatizaciones (Fase 12) escuchan sus
 * disparadores; el resto de los eventos se marcan como entregados.
 */
export const handlers = automationHandlers();
