import { and, asc, count, eq, isNull } from "drizzle-orm";
import { contactDate, lead, organization, type Db } from "@crm/db";
import { DEMO_ORG_SLUG } from "@crm/db/seed";
import { ctxForDemo } from "../properties/demo-seed";
import { addContactDate, addContactRelation } from "./extras";

/** Fechas importantes y vínculos DEMO sobre los clientes del agente DEMO. */
export async function seedDemoContactExtras(
  db: Db,
  today = new Date(),
): Promise<{ skipped: boolean; items: number }> {
  const [org] = await db.select().from(organization).where(eq(organization.slug, DEMO_ORG_SLUG));
  if (!org?.isDemo) throw new Error("No existe la organización DEMO");
  const [existing] = await db
    .select({ n: count() })
    .from(contactDate)
    .where(eq(contactDate.organizationId, org.id));
  if ((existing?.n ?? 0) > 0) return { skipped: true, items: 0 };

  const ctx = await ctxForDemo(db, org.id, "agente");
  const leads = await db
    .select({ contactId: lead.contactId })
    .from(lead)
    .where(and(eq(lead.organizationId, org.id), eq(lead.assignedUserId, ctx.userId), isNull(lead.deletedAt)))
    .orderBy(asc(lead.code));
  const ids = [...new Set(leads.map((l) => l.contactId))];
  if (ids.length < 2) return { skipped: false, items: 0 };

  const inDays = (n: number, yearsAgo = 0) => {
    const d = new Date(today.getTime() + n * 86_400_000);
    d.setUTCFullYear(d.getUTCFullYear() - yearsAgo);
    return d.toISOString().slice(0, 10);
  };
  await addContactDate(db, ctx, {
    contactId: ids[0],
    label: "Cumpleaños (DEMO)",
    date: inDays(3, 38),
    yearly: true,
  });
  await addContactDate(db, ctx, {
    contactId: ids[1],
    label: "Vence su alquiler actual (DEMO)",
    date: inDays(40),
  });
  await addContactRelation(db, ctx, {
    contactId: ids[0],
    relatedContactId: ids[1],
    type: "referrer",
    note: "DEMO",
  });
  return { skipped: false, items: 3 };
}
