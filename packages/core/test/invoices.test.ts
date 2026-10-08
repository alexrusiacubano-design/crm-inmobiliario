import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deal, dealCommission, invoice, property, type DbHandle } from "@crm/db";
import { isValidRut } from "@crm/shared/invoicing";
import {
  ConflictError,
  createContact,
  createInvoice,
  ForbiddenError,
  getInvoice,
  issueInvoice,
  listInvoices,
  pendingToInvoice,
  ValidationError,
  voidInvoice,
} from "../src";
import { createTestOrg, ctxFor, freshDb, type TestOrg } from "./fixtures";

let h: DbHandle;
let org: TestOrg;

async function catchErr(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => null,
    (e: unknown) => e,
  );
}
/** Un RUT válido (para probar la e-Factura). */
function validRut(): string {
  for (let i = 0; i < 1000; i++) {
    const base = `2112345${String(i).padStart(3, "0")}0`;
    for (let d = 0; d <= 9; d++) if (isValidRut(`${base}${d}`)) return `${base}${d}`;
  }
  throw new Error("sin RUT");
}

beforeAll(async () => {
  h = await freshDb();
  org = await createTestOrg(h.db, "fac", {
    admin: { roleKey: "admin" },
    contable: { roleKey: "accounting" },
    agente: { roleKey: "agent", inTeam: true },
  });
});
afterAll(async () => {
  await h.pool.end();
});

async function closedDealWithFee(amount: bigint) {
  const a = await ctxFor(h.db, org, "agente");
  const client = (await createContact(h.db, a, { firstName: "Cli", lastName: "Ente" })).contact;
  const [p] = await h.db
    .insert(property)
    .values({
      organizationId: org.organizationId,
      code: `PROP-${Math.floor(Math.random() * 1e6)}`,
      type: "apartment",
      operations: ["sale"],
      status: "sold",
    })
    .returning();
  const [d] = await h.db
    .insert(deal)
    .values({
      organizationId: org.organizationId,
      code: `OP-${Math.floor(Math.random() * 1e6)}`,
      operation: "sale",
      stage: "closed",
      closedAt: "2026-10-01",
      propertyId: p?.id ?? "",
      clientContactId: client.id,
      currency: "USD",
      priceMinor: 10_000_000n,
      assignedUserId: org.members.agente?.userId ?? "",
    })
    .returning();
  const [c] = await h.db
    .insert(dealCommission)
    .values({
      organizationId: org.organizationId,
      dealId: d?.id ?? "",
      side: "buyer",
      currency: "USD",
      amountMinor: amount,
      status: "collected",
      collectedAt: "2026-10-01",
    })
    .returning();
  return { client, commission: c };
}

describe("facturación", () => {
  it("pendientes, borrador con IVA, emisión, anulación y vuelta a pendiente", async () => {
    const agent = await ctxFor(h.db, org, "agente");
    expect(await catchErr(pendingToInvoice(h.db, agent))).toBeInstanceOf(ForbiddenError);
    const acc = await ctxFor(h.db, org, "contable");
    const { client, commission } = await closedDealWithFee(300_000n);
    const pending = await pendingToInvoice(h.db, acc);
    const item = pending.find((x) => x.sourceId === commission?.id);
    expect(item).toMatchObject({ sourceType: "deal_commission", currency: "USD", amountMinor: "300000" });
    expect(item?.receiver.contactId).toBe(client.id);

    const rut = validRut();
    const base = {
      contactId: client.id,
      receiverName: "Cliente S.A.",
      receiverDocType: "rut",
      receiverDoc: rut,
      currency: "USD",
      lines: [
        {
          description: "Honorarios",
          amount: "3000",
          sourceType: "deal_commission",
          sourceId: commission?.id,
        },
      ],
    };
    expect(await catchErr(createInvoice(h.db, acc, { ...base, currency: "UYU" }))).toBeInstanceOf(
      ValidationError,
    );
    const inv = await createInvoice(h.db, acc, base);
    expect(inv).toMatchObject({
      kind: "e_factura",
      subtotalMinor: 300_000n,
      taxMinor: 66_000n,
      totalMinor: 366_000n,
    });
    expect(inv.code).toBe("FAC-000001");
    expect(await catchErr(createInvoice(h.db, acc, base))).toBeInstanceOf(ConflictError); // ya facturado
    expect((await pendingToInvoice(h.db, acc)).some((x) => x.sourceId === commission?.id)).toBe(false);

    await issueInvoice(h.db, acc, { id: inv.id, cfeSeries: "a", cfeNumber: 1520, issuedAt: "2026-10-07" });
    const got = await getInvoice(h.db, acc, inv.id);
    expect(got.invoice).toMatchObject({ status: "issued", cfeSeries: "A", cfeNumber: 1520 });
    expect(got.lines).toHaveLength(1);
    // Emitida no se modifica (la base lo impide).
    await expect(
      h.db.update(invoice).set({ totalMinor: 1n }).where(eq(invoice.id, inv.id)),
    ).rejects.toThrow();
    expect(
      await catchErr(
        issueInvoice(h.db, acc, { id: inv.id, cfeSeries: "A", cfeNumber: 2, issuedAt: "2026-10-07" }),
      ),
    ).toBeInstanceOf(ConflictError);

    await voidInvoice(h.db, acc, { id: inv.id, reason: "Error en el receptor" });
    expect((await pendingToInvoice(h.db, acc)).some((x) => x.sourceId === commission?.id)).toBe(true);

    // IVA incluido a consumidor final.
    const t = await createInvoice(h.db, acc, {
      receiverName: "Ana",
      receiverDocType: "ci",
      receiverDoc: "1.234.567-2",
      currency: "USD",
      taxIncluded: true,
      lines: [{ description: "Tasación", amount: "122" }],
    });
    expect(t).toMatchObject({
      kind: "e_ticket",
      subtotalMinor: 10_000n,
      taxMinor: 2_200n,
      totalMinor: 12_200n,
    });
    expect(
      await catchErr(
        issueInvoice(h.db, acc, { id: t.id, cfeSeries: "A", cfeNumber: 1520, issuedAt: "2026-10-07" }),
      ),
    ).toBeNull(); // otro tipo de CFE: la numeración es independiente
    const r = await voidInvoice(h.db, acc, { id: t.id, reason: "prueba" });
    expect(r.deleted).toBe(false);
    const draft = await createInvoice(h.db, acc, {
      ...base,
      lines: [{ description: "Ajuste", amount: "10" }],
    });
    expect((await voidInvoice(h.db, acc, { id: draft.id, reason: "borrador" })).deleted).toBe(true);
    const list = await listInvoices(h.db, acc, { status: "all" });
    expect(list.items.map((i) => i.status).sort()).toEqual(["voided", "voided"]);
  });
});
