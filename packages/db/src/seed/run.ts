import { createDb } from "../index";
import { countGeo, seedGeoUruguay, syncPermissions } from "./catalog";
import { DEMO_USERS, demoEmail, seedDemoOrganization } from "./demo";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no está configurada");
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "1") {
    throw new Error("El seed DEMO no se ejecuta en producción (usar ALLOW_DEMO_SEED=1 para forzarlo)");
  }
  const password = process.env.DEMO_PASSWORD;
  if (!password) throw new Error("DEMO_PASSWORD no está configurada");

  const { db, pool } = createDb(url, { max: 1 });
  try {
    await db.transaction(async (tx) => {
      await syncPermissions(tx);
      await seedGeoUruguay(tx);
      const { created } = await seedDemoOrganization(tx, password);
      const geo = await countGeo(tx);
      console.info(
        `Catálogo: ${geo.departments} departamentos, ${geo.localities} localidades, ${geo.neighborhoods} barrios`,
      );
      console.info(
        created ? "Organización DEMO creada. Usuarios:" : "Organización DEMO ya existía. Usuarios:",
      );
      for (const u of DEMO_USERS) console.info(`  ${demoEmail(u.key).padEnd(34)} ${u.jobTitle}`);
    });
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
