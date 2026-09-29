import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";
import { deal, lead, organization, property, type Db } from "@crm/db";
import { DEMO_ORG_SLUG } from "@crm/db/seed";
import { ctxForDemo } from "../properties/demo-seed";
import { createDeal } from "./deals";
import { createOffer, createReservation, respondOffer } from "./offers";

const plusDays = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Negociaciones DEMO: una operación con oferta y contraoferta pendiente, y otra con oferta
 * aceptada y reserva vigente. Solo si la organización DEMO todavía no tiene ofertas.
 */
export async function seedDemoOffers(db: Db): Promise<{ skipped: boolean; deals: number }> {
  const [org] = await db.select().from(organization).where(eq(organization.slug, DEMO_ORG_SLUG));
  if (!org?.isDemo) throw new Error("No existe la organización DEMO");
  const has = async (notes: string) => {
    const [r] = await db
      .select({ n: count() })
      .from(deal)
      .where(and(eq(deal.organizationId, org.id), eq(deal.notes, notes)));
    return (r?.n ?? 0) > 0;
  };
  const [hasSale, hasRent] = [await has("Negociación DEMO"), await has("Alquiler DEMO")];
  if (hasSale && hasRent) return { skipped: true, deals: 0 };

  const agent = await ctxForDemo(db, org.id, "agente");
  const busy = await db
    .select({ propertyId: deal.propertyId, contactId: deal.clientContactId })
    .from(deal)
    .where(eq(deal.organizationId, org.id));
  const props = (
    await db
      .select()
      .from(property)
      .where(
        and(
          eq(property.organizationId, org.id),
          inArray(property.status, ["available", "published"]),
          isNull(property.deletedAt),
        ),
      )
      .orderBy(asc(property.code))
  ).filter((p) => !busy.some((b) => b.propertyId === p.id));
  const leads = (
    await db
      .select({ id: lead.id, contactId: lead.contactId, operation: lead.operation })
      .from(lead)
      .where(
        and(
          eq(lead.organizationId, org.id),
          eq(lead.assignedUserId, agent.userId),
          inArray(lead.status, ["new", "contacted", "qualified", "visit", "offer"]),
          isNull(lead.deletedAt),
        ),
      )
      .orderBy(asc(lead.code))
  ).filter((l) => !busy.some((b) => b.contactId === l.contactId));

  let deals = 0;
  const sale = props.find((p) => p.operations.includes("sale"));
  const buyer = leads.find((l) => l.operation === "buy");
  if (!hasSale && sale && buyer) {
    const d = await createDeal(db, agent, {
      propertyId: sale.id,
      operation: "sale",
      clientContactId: buyer.contactId,
      leadId: buyer.id,
      price: "340000",
      notes: "Negociación DEMO",
    });
    const o = await createOffer(db, agent, {
      dealId: d.id,
      currency: "USD",
      amount: "300000",
      conditions: "Contado, entrega en 60 días",
      validUntil: plusDays(2),
    });
    await respondOffer(db, agent, {
      offerId: o.id,
      response: "counter",
      currency: "USD",
      amount: "325000",
      conditions: "Contado, entrega en 45 días",
      validUntil: plusDays(3),
      note: "El propietario acepta bajar si se acorta la entrega",
    });
    deals += 1;
  }
  const rent = props.find((p) => p.operations.includes("rent") && p.id !== sale?.id);
  const tenant = leads.find((l) => l.operation === "rent");
  if (!hasRent && rent && tenant) {
    const d = await createDeal(db, agent, {
      propertyId: rent.id,
      operation: "rent",
      clientContactId: tenant.contactId,
      leadId: tenant.id,
      currency: "UYU",
      price: "24000",
      notes: "Alquiler DEMO",
    });
    const o = await createOffer(db, agent, { dealId: d.id, currency: "UYU", amount: "23000" });
    await respondOffer(db, agent, { offerId: o.id, response: "accept", note: "El propietario acepta" });
    await createReservation(db, agent, {
      dealId: d.id,
      currency: "UYU",
      deposit: "23000",
      receivedAt: plusDays(-2),
      expiresAt: plusDays(5),
      holder: "agency",
      receiptNumber: "DEMO-0001",
      notes: "Seña equivalente a un mes de alquiler",
    });
    deals += 1;
  }
  return { skipped: false, deals };
}
