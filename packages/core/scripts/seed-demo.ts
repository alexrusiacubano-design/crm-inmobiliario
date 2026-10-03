import { createDb } from "@crm/db";
import { seedDemoAgenda } from "../src/agenda/demo-seed";
import { seedDemoCrm } from "../src/crm/demo-seed";
import { seedDemoContactExtras } from "../src/crm/extras-demo";
import { seedDemoDeals, seedDemoGoals } from "../src/deals/demo-seed";
import { seedDemoOffers } from "../src/deals/offers-demo";
import { seedDemoCommunications } from "../src/communications/demo-seed";
import { seedDemoBilling, seedDemoContracts, seedDemoGuarantees } from "../src/rentals/demo-seed";
import { backfillDemoCoordinates, seedDemoProperties } from "../src/properties/demo-seed";
import { seedDemoPublications } from "../src/properties/publications-demo";
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
    const x = await seedDemoContactExtras(db);
    console.info(x.skipped ? "Fechas y vínculos DEMO ya cargados." : `Fechas y vínculos DEMO: ${x.items}.`);
    const d = await seedDemoDeals(db);
    console.info(d.skipped ? "Operaciones DEMO ya cargadas." : `Operaciones DEMO: ${d.deals}.`);
    const coords = await backfillDemoCoordinates(db);
    if (coords) console.info(`Coordenadas DEMO completadas: ${coords}.`);
    if (await seedDemoGoals(db)) console.info("Metas DEMO cargadas.");
    const o = await seedDemoOffers(db);
    console.info(o.skipped ? "Ofertas DEMO ya cargadas." : `Negociaciones DEMO: ${o.deals}.`);
    const k = await seedDemoContracts(db);
    console.info(k.skipped ? "Contratos DEMO ya cargados." : `Contratos DEMO: ${k.contracts}.`);
    const g = await seedDemoGuarantees(db);
    console.info(g.skipped ? "Garantías DEMO ya cargadas." : `Garantías DEMO: ${g.guarantees}.`);
    const b = await seedDemoBilling(db);
    console.info(b.skipped ? "Cobros DEMO ya cargados." : `Cuotas DEMO: ${b.charges}.`);
    const m = await seedDemoCommunications(db);
    console.info(m.skipped ? "Comunicaciones DEMO ya cargadas." : `Consultas DEMO: ${m.inquiries}.`);
    const pb = await seedDemoPublications(db);
    console.info(pb.skipped ? "Publicaciones DEMO ya cargadas." : `Avisos DEMO: ${pb.publications}.`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
