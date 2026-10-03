import { and, asc, count, eq, inArray, isNull, ne } from "drizzle-orm";
import {
  deal,
  lead,
  organization,
  property,
  rentCharge,
  rentChargeLine,
  rentalContract,
  rentalGuarantee,
  type Db,
} from "@crm/db";
import { addDaysYmd, addMonths } from "@crm/shared";
import { DEMO_ORG_SLUG } from "@crm/db/seed";
import { changeDealStage } from "../deals/deals";
import { ctxForDemo } from "../properties/demo-seed";
import { changeSettlementStatus, createSettlement, generateCharges, registerPayment } from "./billing";
import { createContract } from "./contracts";
import { changeGuaranteeStatus, createGuarantee, setGuaranteeRequirement } from "./guarantees";

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

/** Garantías DEMO: una vigente que vence pronto y un seguro de fianza en trámite. */
export async function seedDemoGuarantees(db: Db): Promise<{ skipped: boolean; guarantees: number }> {
  const [org] = await db.select().from(organization).where(eq(organization.slug, DEMO_ORG_SLUG));
  if (!org?.isDemo) throw new Error("No existe la organización DEMO");
  const [existing] = await db
    .select({ n: count() })
    .from(rentalGuarantee)
    .where(eq(rentalGuarantee.organizationId, org.id));
  if ((existing?.n ?? 0) > 0) return { skipped: true, guarantees: 0 };
  const admin = await ctxForDemo(db, org.id, "administracion");
  const contracts = await db
    .select()
    .from(rentalContract)
    .where(and(eq(rentalContract.organizationId, org.id), eq(rentalContract.status, "active")))
    .orderBy(asc(rentalContract.endDate));
  const t = today();
  let n = 0;
  const [soon, later] = contracts;
  if (soon) {
    const g = await createGuarantee(
      db,
      admin,
      {
        tenantContactId: soon.tenantContactId,
        contractId: soon.id,
        type: "anda",
        provider: "ANDA",
        reference: "DEMO-ANDA-001",
        currency: soon.currency,
        coverage: ((soon.rentMinor * 12n) / 100n).toString(),
        validFrom: soon.startDate,
        validUntil: addDaysYmd(t, 40),
      },
      t,
    );
    for (let i = 0; i < g.requirements.length; i++)
      await setGuaranteeRequirement(db, admin, { id: g.id, index: i, done: true });
    await changeGuaranteeStatus(db, admin, { id: g.id, status: "approved" });
    await changeGuaranteeStatus(db, admin, { id: g.id, status: "active" });
    n += 1;
  }
  if (later) {
    const g = await createGuarantee(
      db,
      admin,
      {
        tenantContactId: later.tenantContactId,
        contractId: later.id,
        type: "insurance",
        provider: "Aseguradora DEMO",
        notes: "Pidieron recibos de los últimos 3 meses",
      },
      t,
    );
    await setGuaranteeRequirement(db, admin, { id: g.id, index: 0, done: true });
    await setGuaranteeRequirement(db, admin, { id: g.id, index: 1, done: true });
    n += 1;
  }
  return { skipped: false, guarantees: n };
}

/** Cobros DEMO: mes anterior cobrado y liquidado, mes actual con pago parcial. */
export async function seedDemoBilling(db: Db): Promise<{ skipped: boolean; charges: number }> {
  const [org] = await db.select().from(organization).where(eq(organization.slug, DEMO_ORG_SLUG));
  if (!org?.isDemo) throw new Error("No existe la organización DEMO");
  const [existing] = await db
    .select({ n: count() })
    .from(rentCharge)
    .where(eq(rentCharge.organizationId, org.id));
  if ((existing?.n ?? 0) > 0) return { skipped: true, charges: 0 };
  const admin = await ctxForDemo(db, org.id, "administracion");
  const accounting = await ctxForDemo(db, org.id, "contabilidad");
  const t = today();
  const current = firstOfMonth(t);
  const previous = addMonths(current, -1);
  const a = await generateCharges(db, admin, { period: previous });
  const b = await generateCharges(db, admin, { period: current });
  const charges = await db
    .select()
    .from(rentCharge)
    .where(eq(rentCharge.organizationId, org.id))
    .orderBy(asc(rentCharge.period));
  for (const ch of charges) {
    const lines = await db.select().from(rentChargeLine).where(eq(rentChargeLine.chargeId, ch.id));
    const total = lines.reduce((s, l) => s + l.amountMinor, 0n);
    if (ch.period === previous) {
      await registerPayment(db, admin, {
        chargeId: ch.id,
        amount: (total / 100n).toString(),
        paidAt: addDaysYmd(ch.dueDate, -1),
        method: "transfer",
        reference: "DEMO",
      });
      const s = await createSettlement(db, accounting, { chargeId: ch.id }).catch(() => null);
      if (s) await changeSettlementStatus(db, accounting, { id: s.id, status: "approved" });
    } else if (ch.period === current) {
      await registerPayment(db, admin, {
        chargeId: ch.id,
        amount: (total / 200n).toString(),
        paidAt: ch.dueDate < t ? ch.dueDate : t,
        method: "cash",
        reference: "Entrega parcial DEMO",
      });
    }
  }
  return { skipped: false, charges: a.created + b.created };
}
