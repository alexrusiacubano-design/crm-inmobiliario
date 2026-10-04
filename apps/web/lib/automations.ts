import "server-only";
import { after } from "next/server";
import { dispatchAutomations, maybeRunScheduledAutomations } from "@crm/core";
import { getDb } from "@crm/db";

/**
 * Corre las automatizaciones después de responder (sin demorar al usuario). En Vercel no hay
 * un worker permanente: los eventos se entregan al final de cada acción y los disparadores
 * programados como mucho una vez por hora por organización al navegar.
 */
export function scheduleAutomations(organizationId?: string): void {
  try {
    after(async () => {
      const db = getDb();
      try {
        for (let i = 0; i < 4; i++) if ((await dispatchAutomations(db, 25)) < 25) break;
        if (organizationId) await maybeRunScheduledAutomations(db, organizationId);
      } catch (error) {
        console.error("[automations] error", error);
      }
    });
  } catch {
    // fuera de un pedido (scripts, pruebas): no hay "after"
  }
}
