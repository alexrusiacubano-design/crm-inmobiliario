import { createDb } from "@crm/db";
import { seedDemoCrm } from "../src/crm/demo-seed";

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
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
