import { count, eq } from "drizzle-orm";
import { inquiry, organization, type Db } from "@crm/db";
import { DEMO_ORG_SLUG } from "@crm/db/seed";
import { ctxForDemo } from "../properties/demo-seed";
import { sendChatMessage, startConversation } from "./chat";
import { ingestInquiry } from "./inbox";

/** Consultas DEMO sin tomar y una conversación interna de ejemplo. */
export async function seedDemoCommunications(db: Db): Promise<{ skipped: boolean; inquiries: number }> {
  const [org] = await db.select().from(organization).where(eq(organization.slug, DEMO_ORG_SLUG));
  if (!org?.isDemo) throw new Error("No existe la organización DEMO");
  const [existing] = await db.select({ n: count() }).from(inquiry).where(eq(inquiry.organizationId, org.id));
  if ((existing?.n ?? 0) > 0) return { skipped: true, inquiries: 0 };
  const samples = [
    {
      channel: "web" as const,
      name: "Florencia Méndez (DEMO)",
      phone: "099 555 101",
      message:
        "Hola, vi el apartamento de Punta Carretas en la web. ¿Sigue disponible? ¿Aceptan financiación?",
      propertyCode: "PROP-000007",
      externalRef: "demo-web-1",
    },
    {
      channel: "portal" as const,
      name: "Diego Rocha (DEMO)",
      email: "diego.demo@example.com",
      phone: "098 222 303",
      message: "Busco alquiler de 2 dormitorios en Cordón o Parque Rodó hasta $ 28.000.",
      externalRef: "demo-portal-1",
    },
    {
      channel: "bot" as const,
      name: "Sin nombre",
      phone: "091 777 888",
      message: "El asistente no pudo responder: pregunta si se aceptan mascotas en la casa de Carrasco.",
      propertyCode: "PROP-000003",
      externalRef: "demo-bot-1",
    },
  ];
  for (const s of samples) await ingestInquiry(db, org.id, s);

  const agent = await ctxForDemo(db, org.id, "agente");
  const supervisor = await ctxForDemo(db, org.id, "supervisor");
  const conv = await startConversation(db, supervisor, { memberIds: [agent.userId] });
  await sendChatMessage(db, supervisor, {
    conversationId: conv.id,
    body: "Martín, ¿pudiste llamar al cliente de la casa de Carrasco? (DEMO)",
  });
  await sendChatMessage(db, agent, {
    conversationId: conv.id,
    body: "Sí, mañana a las 18 hacemos la visita.",
  });
  await sendChatMessage(db, supervisor, { conversationId: conv.id, body: "Genial, avisame cómo sale." });
  return { skipped: false, inquiries: samples.length };
}
