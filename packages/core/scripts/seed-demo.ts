import { createDb } from "@crm/db";
import { seedDemoAgenda } from "../src/agenda/demo-seed";
import { seedDemoCrm } from "../src/crm/demo-seed";
import { seedDemoProperties } from "../src/properties/demo-seed";
import { getStorage } from "../src/storage/provider";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no está configurada");
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "1") {
    throw new Error("El seed DEMO no se ejecuta en producción");
  }
  const { db, pool } = createDb(url, { max: 2 });
  try {
    const r = await seedDemoCrm(db);
    console.info(
      r.skipped
        ? "CRM DEMO ya tenía datos: no se cargó nada."
        : `CRM DEMO: ${r.contacts} contactos, ${r.leads} leads.`,
    );
    if (!process.env.FIELD_ENCRYPTION_KEY) {
      console.warn(
        "FIELD_ENCRYPTION_KEY no está configurada: los propietarios DEMO se cargaron sin cuenta bancaria.",
      );
    }
    const p = await seedDemoProperties(db, getStorage());
    console.info(
      p.skipped
        ? "Propiedades DEMO ya cargadas: no se cargó nada."
        : `Propiedades DEMO: ${p.properties} propiedades, ${p.acquisitions} captaciones.`,
    );
    const a = await seedDemoAgenda(db);
    console.info(
      a.skipped ? "Agenda DEMO ya cargada: no se cargó nada." : `Agenda DEMO: ${a.events} eventos.`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
