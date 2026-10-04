import { dispatchPendingEvents, runScheduledAutomations } from "@crm/core";
import { createDb } from "@crm/db";
import { handlers } from "./handlers";

/**
 * Worker del outbox. Sondea `domain_event` y entrega los eventos pendientes. Varios
 * procesos pueden correr a la vez (FOR UPDATE SKIP LOCKED).
 */
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 2_000);
/** Disparadores programados (leads sin contacto, cuotas vencidas…): cada hora. */
const SCHEDULE_MS = Number(process.env.WORKER_SCHEDULE_MS ?? 60 * 60 * 1000);

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no está configurada");
  const { db, pool } = createDb(url, { max: 3 });
  let running = true;

  const stop = () => {
    running = false;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  console.info(`Worker iniciado (sondeo cada ${POLL_MS} ms)`);

  let lastSchedule = 0;
  while (running) {
    if (Date.now() - lastSchedule > SCHEDULE_MS) {
      lastSchedule = Date.now();
      try {
        const r = await runScheduledAutomations(db);
        if (r.runs) console.info(`Automatizaciones programadas: ${r.runs} ejecución(es)`);
      } catch (error) {
        console.error("Error en automatizaciones programadas", error);
      }
    }
    try {
      const processed = await dispatchPendingEvents(db, handlers);
      if (processed > 0) continue; // hay más trabajo: seguir sin esperar
    } catch (error) {
      console.error("Error al entregar eventos", error);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  await pool.end();
  console.info("Worker detenido");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
