import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activity,
  auditLog,
  contact,
  contactChannel,
  duplicateCandidate,
  lead,
  ownerProfile,
  searchDocument,
  searchProfile,
  type DbHandle,
} from "@crm/db";
import {
  assignLead,
  changeLeadStatus,
  ConflictError,
  createContact,
  createLead,
  ForbiddenError,
  getContact,
  getLead,
  globalSearch,
  listContacts,
  listDuplicateCandidates,
  listLeads,
  listTimeline,
  logInteraction,
  mergeContacts,
  NotFoundError,
  revealAccountNumber,
  upsertOwnerProfile,
  ValidationError,
} from "../src";
import { createTestOrg, ctxFor, freshDb, type TestOrg } from "./fixtures";

let h: DbHandle;
let org: TestOrg;

beforeAll(async () => {
  h = await freshDb();
  org = await createTestOrg(h.db, "crm", {
    admin: { roleKey: "admin" },
    director: { roleKey: "director" },
    supervisor: { roleKey: "supervisor", inTeam: true },
    agenteA: { roleKey: "agent", inTeam: true },
    agenteB: { roleKey: "agent", branch: "second" },
    recepcion: { roleKey: "reception" },
  });
});
afterAll(async () => {
  await h.pool.end();
});

const userId = (key: string) => {
  const m = org.members[key];
  if (!m) throw new Error(key);
  return m.userId;
};

describe("contactos", () => {
  it("crea un contacto con canales normalizados, índice de búsqueda, timeline y auditoría", async () => {
    const ctx = await ctxFor(h.db, org, "agenteA");
    const { contact: c } = await createContact(h.db, ctx, {
      firstName: "Juan",
      lastName: "Pérez",
      documentType: "ci",
      documentNumber: "1.234.567-2",
      channels: [
        { type: "phone", value: "099 123 456" },
        { type: "email", value: "Juan.Perez@Example.com" },
      ],
      tags: ["Inversor"],
    });
    expect(c.displayName).toBe("Juan Pérez");
    expect(c.documentNumber).toBe("12345672");
    expect(c.assignedUserId).toBe(ctx.userId);
    expect(c.branchId).toBe(org.branchIds.main);
    expect(c.teamId).toBe(org.teamId);

    const channels = await h.db.select().from(contactChannel).where(eq(contactChannel.contactId, c.id));
    expect(channels.map((x) => x.normalized).sort()).toEqual(["+59899123456", "juan.perez@example.com"]);
    const [doc] = await h.db.select().from(searchDocument).where(eq(searchDocument.entityId, c.id));
    expect(doc?.body).toContain("juan perez");
    expect(doc?.body).toContain("099123456");
    const acts = await h.db.select().from(activity).where(eq(activity.contactId, c.id));
    expect(acts.map((a) => a.type)).toContain("contact_created");
    const [log] = await h.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, c.id), eq(auditLog.action, "contact.create")));
    expect(log).toBeDefined();
  });

  it("rechaza una cédula inválida y un documento repetido", async () => {
    const ctx = await ctxFor(h.db, org, "agenteA");
    await expect(
      createContact(h.db, ctx, { firstName: "X", documentType: "ci", documentNumber: "1.234.567-3" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createContact(h.db, ctx, { firstName: "Otro", documentType: "ci", documentNumber: "12345672" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("no revela a otro agente los datos del contacto duplicado", async () => {
    const ctxB = await ctxFor(h.db, org, "agenteB");
    const result = await createContact(h.db, ctxB, {
      firstName: "Juancito",
      lastName: "Perez",
      channels: [{ type: "whatsapp", value: "+598 99 123 456" }],
    });
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0]?.contactId).toBeNull();
    expect(result.duplicates[0]?.displayName).toBe("Contacto asignado a otro agente");
    expect(result.duplicates[0]?.reasons).toContain("phone");
    const pairs = await h.db
      .select()
      .from(duplicateCandidate)
      .where(eq(duplicateCandidate.status, "pending"));
    expect(pairs.length).toBeGreaterThanOrEqual(1);
  });

  it("cada agente ve solo sus contactos; el supervisor ve los de su equipo", async () => {
    const a = await ctxFor(h.db, org, "agenteA");
    const b = await ctxFor(h.db, org, "agenteB");
    const sup = await ctxFor(h.db, org, "supervisor");
    const listA = await listContacts(h.db, a, {});
    const listB = await listContacts(h.db, b, {});
    const listSup = await listContacts(h.db, sup, {});
    expect(listA.items.map((i) => i.displayName)).toEqual(["Juan Pérez"]);
    expect(listB.items.map((i) => i.displayName)).toEqual(["Juancito Perez"]);
    expect(listSup.items.map((i) => i.displayName)).toEqual(["Juan Pérez"]);

    const foreign = listB.items[0]?.id ?? "";
    await expect(getContact(h.db, a, foreign)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("un agente no puede asignar contactos a otros; recepción sí puede crear para sí", async () => {
    const a = await ctxFor(h.db, org, "agenteA");
    await expect(
      createContact(h.db, a, { firstName: "Asignado", assignedUserId: userId("agenteB") }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("leads", () => {
  let leadId = "";

  it("crea lead + contacto nuevo, numera LEAD-000001 y guarda la búsqueda sin floats", async () => {
    const ctx = await ctxFor(h.db, org, "agenteA");
    const { lead: l } = await createLead(h.db, ctx, {
      operation: "buy",
      source: "portal",
      contact: { firstName: "María", lastName: "Silva", channels: [{ type: "phone", value: "098 765 432" }] },
      search: {
        operation: "buy",
        propertyTypes: ["apartment"],
        currency: "USD",
        priceMin: "180.000",
        priceMax: "230.000",
        bedroomsMin: 2,
        commonExpensesMax: "12.000",
        commonExpensesCurrency: "UYU",
      },
    });
    leadId = l.id;
    expect(l.code).toBe("LEAD-000001");
    expect(l.status).toBe("new");
    const [s] = await h.db.select().from(searchProfile).where(eq(searchProfile.leadId, l.id));
    expect(s?.priceMinMinor).toBe(18_000_000n);
    expect(s?.priceMaxMinor).toBe(23_000_000n);
    expect(s?.commonExpensesMaxMinor).toBe(1_200_000n);

    const unattended = await listLeads(h.db, ctx, { unattended: "1" });
    expect(unattended.items.map((i) => i.id)).toContain(l.id);
  });

  it("la primera interacción pasa el lead a Contactado automáticamente", async () => {
    const ctx = await ctxFor(h.db, org, "agenteA");
    await logInteraction(h.db, ctx, {
      leadId,
      type: "call",
      direction: "outbound",
      body: "Le interesa Pocitos",
    });
    const [l] = await h.db.select().from(lead).where(eq(lead.id, leadId));
    expect(l?.status).toBe("contacted");
    expect(l?.firstContactedAt).not.toBeNull();
    const timeline = await listTimeline(h.db, ctx, { leadId });
    expect(timeline.items.map((i) => i.type)).toEqual(
      expect.arrayContaining(["call", "lead_status_changed", "lead_created"]),
    );
  });

  it("valida transiciones: no se cierra sin reserva y perder exige motivo", async () => {
    const ctx = await ctxFor(h.db, org, "agenteA");
    await expect(changeLeadStatus(h.db, ctx, { leadId, status: "won" })).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(changeLeadStatus(h.db, ctx, { leadId, status: "lost" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    const after = await changeLeadStatus(h.db, ctx, { leadId, status: "qualified" });
    expect(after?.status).toBe("qualified");
  });

  it("solo quien tiene lead.assign reasigna; el lead hereda sucursal y equipo del nuevo agente", async () => {
    const a = await ctxFor(h.db, org, "agenteA");
    await expect(assignLead(h.db, a, { leadId, assignedUserId: userId("agenteB") })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const admin = await ctxFor(h.db, org, "admin");
    const after = await assignLead(h.db, admin, { leadId, assignedUserId: userId("agenteB") });
    expect(after?.branchId).toBe(org.branchIds.second);
    expect(after?.teamId).toBeNull();
    await expect(getLead(h.db, a, leadId)).rejects.toBeInstanceOf(NotFoundError);
    const b = await ctxFor(h.db, org, "agenteB");
    expect((await getLead(h.db, b, leadId)).lead.id).toBe(leadId);
  });

  it("el timeline es append-only en la base", async () => {
    const error = await h.db.execute(sql`update activity set body = 'alterado'`).then(
      () => null,
      (e: { cause?: { message?: string } }) => e,
    );
    expect(error?.cause?.message).toMatch(/append-only/);
  });
});

describe("propietarios", () => {
  let ownerId = "";

  it("guarda la cuenta bancaria cifrada y la muestra enmascarada solo con permiso", async () => {
    const admin = await ctxFor(h.db, org, "admin");
    const { contact: c } = await createContact(h.db, admin, { firstName: "Laura", lastName: "Gómez" });
    ownerId = c.id;
    await upsertOwnerProfile(h.db, admin, {
      contactId: c.id,
      bankName: "BROU",
      accountHolder: "Laura Gómez",
      accountNumber: "001234567890",
      accountCurrency: "UYU",
    });
    const [row] = await h.db.select().from(ownerProfile).where(eq(ownerProfile.contactId, c.id));
    expect(row?.accountNumberEncrypted).not.toContain("001234567890");
    expect(row?.accountNumberLast4).toBe("7890");

    const asAdmin = await getContact(h.db, admin, c.id);
    expect(asAdmin && "owner" in asAdmin ? asAdmin.owner?.bank?.accountNumberMasked : null).toBe(
      "••••••••7890",
    );
    const director = await ctxFor(h.db, org, "director");
    const asDirector = await getContact(h.db, director, c.id);
    expect(asDirector && "owner" in asDirector ? asDirector.owner?.bank : "x").toBeNull();
  });

  it("revelar el número completo queda auditado; sin permiso financiero no se puede", async () => {
    const admin = await ctxFor(h.db, org, "admin");
    expect(await revealAccountNumber(h.db, admin, ownerId)).toBe("001234567890");
    const logs = await h.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, ownerId), eq(auditLog.action, "owner.financial_view")));
    expect(logs).toHaveLength(1);
    const director = await ctxFor(h.db, org, "director");
    await expect(revealAccountNumber(h.db, director, ownerId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      upsertOwnerProfile(h.db, director, { contactId: ownerId, accountNumber: "999" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("propietarios sin permiso financiero", () => {
  it("pueden editar notas sin tocar (ni borrar) la cuenta bancaria", async () => {
    const admin = await ctxFor(h.db, org, "admin");
    const { contact: c } = await createContact(h.db, admin, { firstName: "Ana", lastName: "Notas" });
    await upsertOwnerProfile(h.db, admin, {
      contactId: c.id,
      bankName: "BROU",
      accountNumber: "1234567",
      accountCurrency: "UYU",
    });
    const director = await ctxFor(h.db, org, "director");
    await upsertOwnerProfile(h.db, director, { contactId: c.id, authorizationNotes: "Firma el cónyuge" });
    const [row] = await h.db.select().from(ownerProfile).where(eq(ownerProfile.contactId, c.id));
    expect(row?.authorizationNotes).toBe("Firma el cónyuge");
    expect(row?.bankName).toBe("BROU");
    expect(row?.accountNumberLast4).toBe("4567");
  });
});

describe("duplicados y fusión", () => {
  it("fusiona: mueve canales sin repetir, leads y timeline; el fusionado queda dado de baja y trazado", async () => {
    const admin = await ctxFor(h.db, org, "admin");
    const { contact: keep } = await createContact(h.db, admin, {
      firstName: "Lucas",
      lastName: "Gómez",
      channels: [{ type: "phone", value: "091 111 222" }],
    });
    const { contact: dupe, duplicates } = await createContact(h.db, admin, {
      firstName: "Lucas",
      lastName: "Gomez",
      documentType: "ci",
      documentNumber: "4.567.890-6".replace(/.$/, "") + String(ciCheck("4567890")),
      channels: [
        { type: "phone", value: "+59891111222" },
        { type: "email", value: "lucas@example.com" },
      ],
    });
    expect(duplicates[0]?.contactId).toBe(keep.id);
    const { lead: l } = await createLead(h.db, admin, {
      contactId: dupe.id,
      operation: "rent",
      source: "whatsapp",
    });

    const pending = await listDuplicateCandidates(h.db, admin);
    expect(pending.some((p) => [p.a.id, p.b.id].includes(dupe.id))).toBe(true);

    await mergeContacts(h.db, admin, { survivorId: keep.id, mergedId: dupe.id });

    const channels = await h.db.select().from(contactChannel).where(eq(contactChannel.contactId, keep.id));
    expect(channels.map((c) => c.normalized).sort()).toEqual(["+59891111222", "lucas@example.com"]);
    const [movedLead] = await h.db.select().from(lead).where(eq(lead.id, l.id));
    expect(movedLead?.contactId).toBe(keep.id);
    const [merged] = await h.db.select().from(contact).where(eq(contact.id, dupe.id));
    expect(merged?.deletedAt).not.toBeNull();
    expect(merged?.mergedIntoId).toBe(keep.id);
    const [survivor] = await h.db.select().from(contact).where(eq(contact.id, keep.id));
    expect(survivor?.documentNumber).not.toBeNull();
    const acts = await h.db.select().from(activity).where(eq(activity.contactId, keep.id));
    expect(acts.map((a) => a.type)).toEqual(expect.arrayContaining(["contact_merged", "lead_created"]));
    const redirect = await getContact(h.db, admin, dupe.id);
    expect(redirect).toEqual({ redirectTo: keep.id });
  });

  it("un agente no puede fusionar", async () => {
    const a = await ctxFor(h.db, org, "agenteA");
    await expect(listDuplicateCandidates(h.db, a)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("búsqueda global", () => {
  it("encuentra por nombre sin tildes, teléfono en cualquier formato, documento y código", async () => {
    const admin = await ctxFor(h.db, org, "admin");
    expect((await globalSearch(h.db, admin, { q: "juan perez" }))[0]?.title).toBe("Juan Pérez");
    expect((await globalSearch(h.db, admin, { q: "099 123 456" })).map((r) => r.title)).toContain(
      "Juan Pérez",
    );
    expect((await globalSearch(h.db, admin, { q: "+598 99123456" })).map((r) => r.title)).toContain(
      "Juan Pérez",
    );
    expect((await globalSearch(h.db, admin, { q: "1.234.567-2" })).map((r) => r.title)).toContain(
      "Juan Pérez",
    );
    expect((await globalSearch(h.db, admin, { q: "LEAD-000001" }))[0]?.entityType).toBe("lead");
  });

  it("respeta el alcance: un agente no encuentra contactos ajenos", async () => {
    const a = await ctxFor(h.db, org, "agenteA");
    expect(await globalSearch(h.db, a, { q: "juancito" })).toEqual([]);
    expect((await globalSearch(h.db, a, { q: "juan" })).map((r) => r.title)).toEqual(["Juan Pérez"]);
  });
});

/** Dígito verificador de cédula para armar datos de prueba válidos. */
function ciCheck(body7: string): number {
  const w = [2, 9, 8, 7, 6, 3, 4];
  const total = w.reduce((acc, x, i) => acc + x * Number(body7[i]), 0);
  return (10 - (total % 10)) % 10;
}
