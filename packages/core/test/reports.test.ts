import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "@crm/db";
import {
  changeLeadStatus,
  commercialReport,
  createLead,
  ForbiddenError,
  inventoryReport,
  operationsReport,
  rentalsReport,
  reportFilters,
} from "../src";
import { createTestOrg, ctxFor, freshDb, type TestOrg } from "./fixtures";

let h: DbHandle;
let org: TestOrg;
const today = new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  h = await freshDb();
  org = await createTestOrg(h.db, "rep", {
    director: { roleKey: "director" },
    supervisor: { roleKey: "supervisor", inTeam: true },
    agenteA: { roleKey: "agent", inTeam: true },
    agenteB: { roleKey: "agent", branch: "second" },
  });
});
afterAll(async () => {
  await h.pool.end();
});

async function lead(who: "agenteA" | "agenteB", source: string) {
  const ctx = await ctxFor(h.db, org, who);
  return (
    await createLead(h.db, ctx, {
      operation: "buy",
      source,
      contact: { firstName: "R", lastName: who, phone: `09${Math.floor(1e6 + Math.random() * 8e6)}` },
    })
  ).lead;
}

describe("reportes", () => {
  it("los agentes no ven reportes", async () => {
    const a = await ctxFor(h.db, org, "agenteA");
    await expect(commercialReport(h.db, a, { period: "month", today })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("embudo por etapa más avanzada, fuentes, agentes y alcance", async () => {
    const a = await ctxFor(h.db, org, "agenteA");
    const l1 = await lead("agenteA", "portal");
    const l2 = await lead("agenteA", "portal");
    await lead("agenteA", "website");
    await lead("agenteB", "referral");
    await changeLeadStatus(h.db, a, { leadId: l1.id, status: "contacted" });
    await changeLeadStatus(h.db, a, { leadId: l1.id, status: "visit" });
    await changeLeadStatus(h.db, a, { leadId: l1.id, status: "lost", lostReason: "price" });
    await changeLeadStatus(h.db, a, { leadId: l2.id, status: "contacted" });

    const d = await ctxFor(h.db, org, "director");
    const r = await commercialReport(h.db, d, { period: "month", today });
    expect(r.totals.leads).toBe(4);
    expect(r.totals.lost).toBe(1);
    expect(r.funnel.find((f) => f.stage === "contacted")?.count).toBe(2);
    expect(r.funnel.find((f) => f.stage === "visit")?.count).toBe(1); // el perdido llegó a visita
    expect(r.bySource[0]).toMatchObject({ source: "portal", leads: 2 });
    expect(r.lostReasons).toEqual([{ reason: "price", count: 1 }]);
    expect(r.trend).toHaveLength(12);
    expect(r.trend.at(-1)?.value).toBe(4);

    // El supervisor solo ve su equipo (agenteB no está en el equipo).
    const s = await ctxFor(h.db, org, "supervisor");
    const rs = await commercialReport(h.db, s, { period: "month", today });
    expect(rs.totals.leads).toBe(3);
    // Filtro por agente.
    const rb = await commercialReport(h.db, d, {
      period: "month",
      today,
      userId: org.members.agenteB?.userId,
    });
    expect(rb.totals.leads).toBe(1);
    const f = await reportFilters(h.db, d);
    expect(f.branches.length).toBe(2);
  });

  it("operaciones, alquileres e inventario responden sin datos", async () => {
    const d = await ctxFor(h.db, org, "director");
    const ops = await operationsReport(h.db, d, { period: "year", today });
    expect(ops.totals.closed).toBe(0);
    expect(ops.trend).toHaveLength(12);
    const rent = await rentalsReport(h.db, d, { period: "month", today });
    expect(rent.activeContracts).toBe(0);
    expect(rent.collectionRate.USD).toBeNull();
    const inv = await inventoryReport(h.db, d, { period: "month", today });
    expect(inv.active).toBe(0);
    await expect(
      commercialReport(h.db, d, { period: "custom", from: "2026-05-01", to: "2026-01-01", today }),
    ).rejects.toThrow("inválido");
  });
});
