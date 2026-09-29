import { and, asc, count, eq, inArray, isNull, ne } from "drizzle-orm";
import { deal, lead, organization, property, rentalContract, type Db } from "@crm/db";
import { addMonths } from "@crm/shared";
import { DEMO_ORG_SLUG } from "@crm/db/seed";
import { changeDealStage } from "../deals/deals";
import { ctxForDemo } from "../properties/demo-seed";
import { createContract } from "./contracts";

const today = () => new Date().toISOString().slice(0, 10);
const firstOfMonth = (ymd: string) => `${ymd.slice(0, 7)}-01`;

/**
 * Contratos DEMO: uno nacido de la operación de alquiler DEMO (empieza el mes que viene) y otro
 * que vence en menos de 90 días con un ajuste atrasado, para ver los avisos.
 */
export async function seedDemoContracts(db: Db): Promise<{ skipped: boolean; contracts: number }> {
  const [org] = await db.select().from(organization).where(eq(organization.slug, DEMO_ORG_SLUG));
  if (!org?.isDemo) throw new Error("No existe la organización DEMO");
  const [existing] = await db
    .select({ n: count() })
    .from(rentalContract)
    .where(eq(rentalContract.organizationId, org.id));
  if ((existing?.n ?? 0) > 0) return { skipped: true, contracts: 0 };

  const agent = await ctxForDemo(db, org.id, "agente");
  const admin = await ctxForDemo(db, org.id, "administracion");
  let contracts = 0;

  const [rentDeal] = await db
    .select()
    .from(deal)
    .where(and(eq(deal.organizationId, org.id), eq(deal.notes, "Alquiler DEMO"), isNull(deal.deletedAt)));
  if (rentDeal && rentDeal.stage !== "fallen") {
    if (rentDeal.stage === "reserved") await changeDealStage(db, agent, { id: rentDeal.id, stage: "notary" });
    if (rentDeal.stage === "reserved" || rentDeal.stage === "notary")
      await changeDealStage(db, agent, { id: rentDeal.id, stage: "signed" });
    await createContract(db, admin, {
      propertyId: rentDeal.propertyId,
      tenantContactId: rentDeal.clientContactId,
      dealId: rentDeal.id,
      startDate: addMonths(firstOfMonth(today()), 1),
      months: 24,
      currency: rentDeal.currency,
      rent: (rentDeal.priceMinor / 100n).toString(),
      paymentDay: 10,
      adjustmentIndex: "ipc",
      adjustmentMonths: 12,
      deposit: (rentDeal.priceMinor / 100n).toString(),
      adminFeePercent: "6",
      guaranteeNote: "Seguro de alquiler (DEMO)",
      notes: "Contrato DEMO",
    });
    contracts += 1;
  }

  const candidates = await db
    .select()
    .from(property)
    .where(
      and(
        eq(property.organizationId, org.id),
        isNull(property.deletedAt),
        rentDeal ? ne(property.id, rentDeal.propertyId) : undefined,
        inArray(property.status, ["available", "published", "draft"]),
      ),
    )
    .orderBy(asc(property.code));
  const other =
    candidates.find((p) => p.operations.includes("rent")) ??
    candidates.find((p) => p.operations.includes("temporary_rent"));
  const tenants = await db
    .select({ contactId: lead.contactId })
    .from(lead)
    .where(and(eq(lead.organizationId, org.id), eq(lead.operation, "rent"), isNull(lead.deletedAt)))
    .orderBy(asc(lead.code));
  const tenant = tenants.find((t) => t.contactId !== rentDeal?.clientContactId);
  if (other && tenant) {
    await createContract(db, admin, {
      propertyId: other.id,
      tenantContactId: tenant.contactId,
      startDate: addMonths(firstOfMonth(today()), -10),
      months: 12,
      currency: "UYU",
      rent: "38000",
      paymentDay: 5,
      adjustmentIndex: "ipc",
      adjustmentMonths: 6,
      adminFeePercent: "7",
      guaranteeNote: "ANDA (DEMO)",
      notes: "Contrato DEMO por vencer",
    });
    contracts += 1;
  }
  return { skipped: false, contracts };
}
