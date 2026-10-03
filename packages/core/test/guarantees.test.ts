import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { locality, neighborhood, rentalGuarantee, type DbHandle } from "@crm/db";
import { seedGeoUruguay } from "@crm/db/seed";
import {
  changeGuaranteeStatus,
  changePropertyStatus,
  closeContract,
  ConflictError,
  contractsWithoutGuarantee,
  createContact,
  createContract,
  createGuarantee,
  createLead,
  createProperty,
  ForbiddenError,
  listGuarantees,
  renewContract,
  setGuaranteeRequirement,
  updateGuarantee,
  ValidationError,
} from "../src";
import { createTestOrg, ctxFor, freshDb, type TestOrg } from "./fixtures";

let h: DbHandle;
let org: TestOrg;
let geo: { localityId: number; neighborhoodId: number };
const today = "2026-10-03";

async function catchErr(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => null,
    (e: unknown) => e,
  );
}

beforeAll(async () => {
  h = await freshDb();
  await seedGeoUruguay(h.db);
  const [n] = await h.db
    .select({ localityId: locality.id, neighborhoodId: neighborhood.id })
    .from(neighborhood)
    .innerJoin(locality, eq(locality.id, neighborhood.localityId))
    .limit(1);
  if (!n) throw new Error("geo");
  geo = n;
  org = await createTestOrg(h.db, "guar", {
    adm: { roleKey: "rental_admin" },
    agenteA: { roleKey: "agent", inTeam: true },
  });
});
afterAll(async () => {
  await h.pool.end();
});

async function contractSetup() {
  const a = await ctxFor(h.db, org, "agenteA");
  const adm = await ctxFor(h.db, org, "adm");
  const p = await createProperty(h.db, a, {
    type: "apartment",
    operations: ["rent"],
    title: "Apto",
    localityId: geo.localityId,
    neighborhoodId: geo.neighborhoodId,
  });
  await changePropertyStatus(h.db, a, { propertyId: p.id, status: "available" });
  const { lead } = await createLead(h.db, a, {
    operation: "rent",
    source: "portal",
    contact: { firstName: "Inqui", lastName: Math.random().toString(36).slice(2, 7) },
  });
  const c = await createContract(h.db, adm, {
    propertyId: p.id,
    tenantContactId: lead.contactId,
    startDate: "2026-10-01",
    months: 24,
    rent: "25000",
  });
  return { adm, a, c, tenantId: lead.contactId };
}

describe("garantías", () => {
  it("trámite con requisitos → aprobada → vigente; avisa si no cubre todo el contrato", async () => {
    const { adm, c, tenantId } = await contractSetup();
    const g = await createGuarantee(
      h.db,
      adm,
      { tenantContactId: tenantId, type: "insurance", provider: "Aseguradora X", coverage: "600000" },
      today,
    );
    expect(g.status).toBe("in_process");
    expect(g.requirements.length).toBe(4);
    expect((await contractsWithoutGuarantee(h.db, adm)).some((x) => x.id === c.id)).toBe(true);

    await changeGuaranteeStatus(h.db, adm, { id: g.id, status: "approved" });
    expect(
      await catchErr(changeGuaranteeStatus(h.db, adm, { id: g.id, status: "active", contractId: c.id })),
    ).toBeInstanceOf(ConflictError); // faltan requisitos
    for (let i = 0; i < 4; i++) await setGuaranteeRequirement(h.db, adm, { id: g.id, index: i, done: true });
    expect(await catchErr(changeGuaranteeStatus(h.db, adm, { id: g.id, status: "active" }))).toBeInstanceOf(
      ValidationError,
    ); // sin contrato
    await updateGuarantee(h.db, adm, {
      id: g.id,
      type: "insurance",
      provider: "Aseguradora X",
      reference: "POL-123",
      coverage: "600000",
      validFrom: "2026-10-01",
      validUntil: "2027-09-30",
    });
    await changeGuaranteeStatus(h.db, adm, { id: g.id, status: "active", contractId: c.id });
    expect((await contractsWithoutGuarantee(h.db, adm)).some((x) => x.id === c.id)).toBe(false);

    const alerts = await listGuarantees(h.db, adm, { status: "alerts" }, "2027-09-01");
    const item = alerts.items.find((x) => x.id === g.id);
    expect(item?.alerts).toEqual(["expiring"]);
    expect(item?.shortOfContract).toBe(true); // el contrato termina en 2028

    expect(
      await catchErr(changeGuaranteeStatus(h.db, adm, { id: g.id, status: "in_process" })),
    ).toBeInstanceOf(ConflictError);
  });

  it("la renovación arrastra la garantía y cerrar el contrato la libera", async () => {
    const { adm, c, tenantId } = await contractSetup();
    const g = await createGuarantee(
      h.db,
      adm,
      { tenantContactId: tenantId, contractId: c.id, type: "deposit" },
      today,
    );
    expect(g.depositPlace).toBe("bhu");
    for (let i = 0; i < g.requirements.length; i++)
      await setGuaranteeRequirement(h.db, adm, { id: g.id, index: i, done: true });
    await changeGuaranteeStatus(h.db, adm, { id: g.id, status: "approved" });
    await changeGuaranteeStatus(h.db, adm, { id: g.id, status: "active" });
    const renewed = await renewContract(h.db, adm, { contractId: c.id, months: 12 });
    const [moved] = await h.db.select().from(rentalGuarantee).where(eq(rentalGuarantee.id, g.id));
    expect(moved?.contractId).toBe(renewed.id);
    await closeContract(h.db, adm, {
      contractId: renewed.id,
      kind: "terminated",
      date: "2029-01-15",
      reason: "Se fue",
    });
    const [released] = await h.db.select().from(rentalGuarantee).where(eq(rentalGuarantee.id, g.id));
    expect(released?.status).toBe("released");
  });

  it("fiador solo en garantía propietaria; rechazo con motivo; un agente no gestiona", async () => {
    const { adm, a, tenantId } = await contractSetup();
    const { contact: fiador } = await createContact(h.db, a, { firstName: "Fia", lastName: "Dor" });
    expect(
      await catchErr(
        createGuarantee(
          h.db,
          adm,
          { tenantContactId: tenantId, type: "anda", guarantorContactId: fiador.id },
          today,
        ),
      ),
    ).toBeInstanceOf(ValidationError);
    const g = await createGuarantee(
      h.db,
      adm,
      { tenantContactId: tenantId, type: "property_guarantor", guarantorContactId: fiador.id },
      today,
    );
    expect(await catchErr(changeGuaranteeStatus(h.db, adm, { id: g.id, status: "rejected" }))).toBeInstanceOf(
      ValidationError,
    );
    await changeGuaranteeStatus(h.db, adm, {
      id: g.id,
      status: "rejected",
      note: "El inmueble tiene embargo",
    });
    expect(
      await catchErr(createGuarantee(h.db, a, { tenantContactId: tenantId, type: "anda" }, today)),
    ).toBeInstanceOf(ForbiddenError);
    const list = await listGuarantees(h.db, adm, { status: "closed" }, today);
    expect(list.items.find((x) => x.id === g.id)?.guarantorName).toBe("Fia Dor");
  });
});
