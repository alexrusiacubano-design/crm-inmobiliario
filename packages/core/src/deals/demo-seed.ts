import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";
import { deal, lead, organization, property, type Db } from "@crm/db";
import { DEMO_ORG_SLUG } from "@crm/db/seed";
import { ctxForDemo } from "../properties/demo-seed";
import { changeDealStage, collectCommission, createDeal, getDeal, setDealCommissions } from "./deals";

function monthsAgo(n: number, day = 15): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - n);
  d.setUTCDate(day);
  return d.toISOString().slice(0, 10);
}

/** Operaciones DEMO: una en escribanía, una reservada y una cerrada con honorarios cobrados. */
export async function seedDemoDeals(db: Db): Promise<{ skipped: boolean; deals: number }> {
  const [org] = await db.select().from(organization).where(eq(organization.slug, DEMO_ORG_SLUG));
  if (!org?.isDemo) throw new Error("No existe la organización DEMO");
  const [existing] = await db.select({ n: count() }).from(deal).where(eq(deal.organizationId, org.id));
  if ((existing?.n ?? 0) > 0) return { skipped: true, deals: 0 };

  const agent = await ctxForDemo(db, org.id, "agente");
  const director = await ctxForDemo(db, org.id, "director");
  const accounting = await ctxForDemo(db, org.id, "contabilidad");
  const props = await db
    .select()
    .from(property)
    .where(
      and(
        eq(property.organizationId, org.id),
        eq(property.assignedUserId, agent.userId),
        inArray(property.status, ["available", "published"]),
        isNull(property.deletedAt),
      ),
    )
    .orderBy(asc(property.code));
  const leads = await db
    .select({ id: lead.id, contactId: lead.contactId, operation: lead.operation })
    .from(lead)
    .where(
      and(eq(lead.organizationId, org.id), eq(lead.assignedUserId, agent.userId), isNull(lead.deletedAt)),
    )
    .orderBy(asc(lead.code));
  const sale = props.filter((p) => p.operations.includes("sale"));
  const buyers = leads.filter((l) => l.operation === "buy");
  if (sale.length < 2 || buyers.length < 2) return { skipped: false, deals: 0 };

  // 1) Cerrada hace dos meses, con los dos honorarios cobrados.
  const [s0, s1] = sale;
  const [b0, b1] = buyers;
  if (!s0 || !s1 || !b0 || !b1) return { skipped: false, deals: 0 };
  const closed = await createDeal(db, agent, {
    propertyId: s0.id,
    operation: "sale",
    clientContactId: b0.contactId,
    leadId: b0.id,
    price: "210000",
    notes: "Operación DEMO",
  });
  await setDealCommissions(db, agent, {
    dealId: closed.id,
    lines: [
      { side: "seller", currency: "USD", amount: "6300", dueDate: monthsAgo(2, 10) },
      { side: "buyer", currency: "USD", amount: "6300", dueDate: monthsAgo(2, 10) },
    ],
  });
  await changeDealStage(db, agent, { id: closed.id, stage: "reserved" });
  await changeDealStage(db, director, { id: closed.id, stage: "closed", closedAt: monthsAgo(2, 8) });
  const full = await getDeal(db, accounting, closed.id);
  for (const [i, c] of full.commissions.entries())
    await collectCommission(db, accounting, {
      commissionId: c.id,
      collectedAt: monthsAgo(i === 0 ? 2 : 1, 12),
      reference: `Recibo DEMO ${i + 1}`,
    });

  // 2) En escribanía, con honorario pendiente.
  const notary = await createDeal(db, agent, {
    propertyId: s1.id,
    operation: "sale",
    clientContactId: b1.contactId,
    leadId: b1.id,
    price: "395000",
    expectedCloseDate: monthsAgo(-1, 5),
    notes: "Operación DEMO",
  });
  await changeDealStage(db, agent, { id: notary.id, stage: "reserved" });
  await changeDealStage(db, agent, { id: notary.id, stage: "notary" });
  return { skipped: false, deals: 2 };
}
