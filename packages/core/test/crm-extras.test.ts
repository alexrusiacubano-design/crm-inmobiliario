import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { calendarEvent, contactDate, contactRelation, type DbHandle } from "@crm/db";
import { seedGeoUruguay } from "@crm/db/seed";
import {
  addContactDate,
  addContactRelation,
  changeLeadStatus,
  ConflictError,
  createContact,
  createEvent,
  createLead,
  deleteContactDate,
  ForbiddenError,
  listContactDates,
  listContactRelations,
  listContacts,
  mergeContacts,
  nextOccurrence,
  NotFoundError,
  removeContactRelation,
  upcomingContactDates,
  ValidationError,
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

beforeAll(async () => {
  h = await freshDb();
  await seedGeoUruguay(h.db);
  org = await createTestOrg(h.db, "extras", {
    admin: { roleKey: "admin" },
    agenteA: { roleKey: "agent", inTeam: true },
    agenteB: { roleKey: "agent", branch: "second" },
  });
});
afterAll(async () => {
  await h.pool.end();
});

async function person(key: string, first: string) {
  const ctx = await ctxFor(h.db, org, key);
  return (
    await createContact(h.db, ctx, { firstName: first, lastName: Math.random().toString(36).slice(2, 7) })
  ).contact;
}

describe("próxima ocurrencia de fechas", () => {
  it("anuales se proyectan; únicas vencidas no aparecen; 29/2 cae el 28/2", () => {
    expect(nextOccurrence("1985-10-02", true, "2026-09-28")).toEqual({ date: "2026-10-02", days: 4 });
    expect(nextOccurrence("1985-09-01", true, "2026-09-28")?.date).toBe("2027-09-01");
    expect(nextOccurrence("2026-09-01", false, "2026-09-28")).toBeNull();
    expect(nextOccurrence("2026-10-28", false, "2026-09-28")).toEqual({ date: "2026-10-28", days: 30 });
    expect(nextOccurrence("2000-02-29", true, "2027-01-10")?.date).toBe("2027-02-28");
  });
});

describe("estado de clientes (tablero)", () => {
  it("activo, cerrado y descartado según sus leads, con filtro por fuente", async () => {
    const ctx = await ctxFor(h.db, org, "agenteA");
    const mk = async (first: string, source: "portal" | "whatsapp") =>
      (
        await createLead(h.db, ctx, {
          operation: "buy",
          source,
          contact: {
            firstName: first,
            lastName: "Tablero",
            channels: [{ type: "phone", value: `09${Math.floor(1e6 + Math.random() * 8e6)}` }],
          },
        })
      ).lead;
    const active = await mk("Activa", "whatsapp");
    const discarded = await mk("Descartada", "portal");
    await changeLeadStatus(h.db, ctx, { leadId: discarded.id, status: "lost", lostReason: "price" });
    const won = await mk("Ganada", "portal");
    for (const st of ["contacted", "qualified", "visit", "offer", "reservation", "won"] as const)
      await changeLeadStatus(h.db, ctx, { leadId: won.id, status: st });

    const ids = async (state: string, extra: Record<string, string> = {}) =>
      (await listContacts(h.db, ctx, { role: "client", state, ...extra })).items.map((i) => i.id);
    expect(await ids("active")).toContain(active.contactId);
    expect(await ids("active")).not.toContain(discarded.contactId);
    expect(await ids("closed")).toContain(won.contactId);
    expect(await ids("discarded")).toContain(discarded.contactId);
    expect(await ids("all")).toEqual(
      expect.arrayContaining([active.contactId, won.contactId, discarded.contactId]),
    );
    expect(await ids("all", { source: "whatsapp" })).toContain(active.contactId);
    expect(await ids("all", { source: "whatsapp" })).not.toContain(won.contactId);
    const row = (await listContacts(h.db, ctx, { role: "client", state: "closed" })).items.find(
      (i) => i.id === won.contactId,
    );
    expect(row?.clientState).toBe("closed");
    expect(row?.lastSource).toBe("portal");
    expect(row?.whatsapp).toBe(true);
  });
});

describe("fechas importantes", () => {
  it("alta, listado ordenado, próximas en dashboard y baja; otro agente no puede", async () => {
    const ctx = await ctxFor(h.db, org, "agenteA");
    const c = await person("agenteA", "Cumple");
    const today = "2026-09-28";
    await addContactDate(h.db, ctx, {
      contactId: c.id,
      label: "Cumpleaños",
      date: "1980-10-01",
      yearly: true,
    });
    const d2 = await addContactDate(h.db, ctx, {
      contactId: c.id,
      label: "Vence contrato",
      date: "2027-03-01",
    });
    const list = await listContactDates(h.db, ctx, c.id, today);
    expect(list[0]?.label).toBe("Cumpleaños");
    expect(list[0]?.next?.days).toBe(3);
    const up = await upcomingContactDates(h.db, ctx, today, 14);
    expect(up.some((u) => u.contactId === c.id)).toBe(true);
    const b = await ctxFor(h.db, org, "agenteB");
    expect((await upcomingContactDates(h.db, b, today, 14)).some((u) => u.contactId === c.id)).toBe(false);
    expect(
      await catchErr(addContactDate(h.db, b, { contactId: c.id, label: "Xx", date: "2027-01-01" })),
    ).toBeInstanceOf(NotFoundError);
    expect(
      await catchErr(addContactDate(h.db, ctx, { contactId: c.id, label: "Xx", date: "2027-13-01" })),
    ).toBeInstanceOf(ValidationError);
    await deleteContactDate(h.db, ctx, d2.id);
    expect((await listContactDates(h.db, ctx, c.id, today)).length).toBe(1);
  });
});

describe("vínculos", () => {
  it("se ven desde ambos lados, no se duplican y ocultan contactos ajenos", async () => {
    const a = await ctxFor(h.db, org, "agenteA");
    const b = await ctxFor(h.db, org, "agenteB");
    const x = await person("agenteA", "Esposa");
    const y = await person("agenteA", "Esposo");
    const z = await person("agenteB", "Abogado");
    await addContactRelation(h.db, a, { contactId: x.id, relatedContactId: y.id, type: "spouse" });
    expect(
      await catchErr(
        addContactRelation(h.db, a, { contactId: y.id, relatedContactId: x.id, type: "spouse" }),
      ),
    ).toBeInstanceOf(ConflictError);
    expect(
      await catchErr(
        addContactRelation(h.db, a, { contactId: x.id, relatedContactId: x.id, type: "family" }),
      ),
    ).toBeInstanceOf(ValidationError);
    // El agente A no ve al contacto del agente B: no puede vincularlo.
    expect(
      await catchErr(
        addContactRelation(h.db, a, { contactId: x.id, relatedContactId: z.id, type: "lawyer" }),
      ),
    ).toBeInstanceOf(NotFoundError);
    const fromY = await listContactRelations(h.db, a, y.id);
    expect(fromY[0]?.otherId).toBe(x.id);
    expect(fromY[0]?.type).toBe("spouse");

    // El admin vincula al abogado (de B) con X: A lo ve como restringido.
    const admin = await ctxFor(h.db, org, "admin");
    const rel = await addContactRelation(h.db, admin, {
      contactId: z.id,
      relatedContactId: x.id,
      type: "lawyer",
    });
    const fromX = await listContactRelations(h.db, a, x.id);
    const lawyer = fromX.find((r) => r.type === "lawyer");
    expect(lawyer?.otherId).toBeNull();
    expect(lawyer?.otherName).toBe("Contacto (restringido)");
    expect(await catchErr(removeContactRelation(h.db, b, fromY[0]?.id ?? ""))).toBeInstanceOf(NotFoundError);
    await removeContactRelation(h.db, a, rel.id);
    expect((await listContactRelations(h.db, a, x.id)).some((r) => r.type === "lawyer")).toBe(false);
    expect(ForbiddenError).toBeDefined();
  });
});

describe("fusión de duplicados", () => {
  it("mueve agenda, fechas y vínculos al contacto que queda", async () => {
    const admin = await ctxFor(h.db, org, "admin");
    const keep = await person("agenteA", "Queda");
    const gone = await person("agenteA", "Sefusiona");
    const friend = await person("agenteA", "Amigo");
    await addContactDate(h.db, admin, {
      contactId: gone.id,
      label: "Cumpleaños",
      date: "1990-05-05",
      yearly: true,
    });
    await addContactRelation(h.db, admin, {
      contactId: gone.id,
      relatedContactId: friend.id,
      type: "referrer",
    });
    await addContactRelation(h.db, admin, { contactId: gone.id, relatedContactId: keep.id, type: "family" });
    const ev = await createEvent(h.db, admin, {
      type: "call",
      title: "Llamar",
      startsAt: new Date().toISOString(),
      contactId: gone.id,
    });
    await mergeContacts(h.db, admin, { survivorId: keep.id, mergedId: gone.id });
    const [e] = await h.db.select().from(calendarEvent).where(eq(calendarEvent.id, ev.id));
    expect(e?.contactId).toBe(keep.id);
    const dates = await h.db.select().from(contactDate).where(eq(contactDate.contactId, keep.id));
    expect(dates.length).toBe(1);
    const rels = await listContactRelations(h.db, admin, keep.id);
    expect(rels.map((r) => r.otherId)).toEqual([friend.id]);
    const leftovers = await h.db.select().from(contactRelation).where(eq(contactRelation.contactId, gone.id));
    expect(leftovers.length).toBe(0);
  });
});
