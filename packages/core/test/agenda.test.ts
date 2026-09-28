import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activity,
  auditLog,
  calendarEvent,
  domainEvent,
  locality,
  neighborhood,
  type DbHandle,
} from "@crm/db";
import { seedGeoUruguay } from "@crm/db/seed";
import {
  agendaOverview,
  closeEvent,
  ConflictError,
  createContact,
  createEvent,
  createProperty,
  deleteEvent,
  eventsFor,
  ForbiddenError,
  getEvent,
  listEvents,
  NotFoundError,
  reopenEvent,
  updateEvent,
  ValidationError,
} from "../src";
import { createTestOrg, ctxFor, freshDb, type TestOrg } from "./fixtures";

let h: DbHandle;
let org: TestOrg;
let propertyId: string;
let contactId: string;

const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

async function catchErr(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => null,
    (e: unknown) => e,
  );
}

beforeAll(async () => {
  h = await freshDb();
  await seedGeoUruguay(h.db);
  org = await createTestOrg(h.db, "agenda", {
    admin: { roleKey: "admin" },
    supervisor: { roleKey: "supervisor", inTeam: true },
    agenteA: { roleKey: "agent", inTeam: true },
    agenteB: { roleKey: "agent", branch: "second" },
    recepcion: { roleKey: "reception" },
    contable: { roleKey: "accounting" },
  });
  const [geo] = await h.db
    .select({ localityId: locality.id, neighborhoodId: neighborhood.id })
    .from(neighborhood)
    .innerJoin(locality, eq(locality.id, neighborhood.localityId))
    .limit(1);
  const ctx = await ctxFor(h.db, org, "agenteA");
  const p = await createProperty(h.db, ctx, {
    type: "apartment",
    operations: ["sale"],
    title: "Apartamento para visitas",
    localityId: geo?.localityId,
    neighborhoodId: geo?.neighborhoodId,
  });
  propertyId = p.id;
  const { contact } = await createContact(h.db, ctx, { firstName: "Clara", lastName: "Interesada" });
  contactId = contact.id;
});
afterAll(async () => {
  await h.pool.end();
});

function visit(extra: Record<string, unknown> = {}) {
  return {
    type: "visit",
    title: "Visita al apartamento",
    startsAt: iso(Date.now() + 2 * HOUR),
    endsAt: iso(Date.now() + 3 * HOUR),
    propertyId,
    contactId,
    ...extra,
  };
}

describe("agenda", () => {
  it("crea una visita propia con sucursal/equipo del responsable, auditoría y evento", async () => {
    const ctx = await ctxFor(h.db, org, "agenteA");
    const e = await createEvent(h.db, ctx, visit());
    expect(e.assignedUserId).toBe(ctx.userId);
    expect(e.branchId).toBe(org.branchIds.main);
    expect(e.teamId).toBe(org.teamId);
    expect(e.status).toBe("scheduled");
    const audits = await h.db.select().from(auditLog).where(eq(auditLog.entityId, e.id));
    expect(audits.map((a) => a.action)).toContain("event.create");
    const evts = await h.db.select().from(domainEvent).where(eq(domainEvent.aggregateId, e.id));
    expect(evts.map((x) => x.type)).toContain("calendar_event.created");
  });

  it("valida: una visita necesita propiedad y el fin no puede ser anterior al inicio", async () => {
    const ctx = await ctxFor(h.db, org, "agenteA");
    expect(await catchErr(createEvent(h.db, ctx, visit({ propertyId: null })))).toBeInstanceOf(
      ValidationError,
    );
    expect(
      await catchErr(
        createEvent(
          h.db,
          ctx,
          visit({ endsAt: iso(Date.now() + HOUR), startsAt: iso(Date.now() + 5 * HOUR) }),
        ),
      ),
    ).toBeInstanceOf(ValidationError);
  });

  it("un agente no agenda para otro; recepción sí puede agendar visitas para cualquiera", async () => {
    const a = await ctxFor(h.db, org, "agenteA");
    const b = await ctxFor(h.db, org, "agenteB");
    expect(await catchErr(createEvent(h.db, a, visit({ assignedUserId: b.userId })))).toBeInstanceOf(
      ForbiddenError,
    );
    const r = await ctxFor(h.db, org, "recepcion");
    const e = await createEvent(h.db, r, visit({ assignedUserId: a.userId }));
    expect(e.assignedUserId).toBe(a.userId);
  });

  it("contabilidad no gestiona agenda", async () => {
    const c = await ctxFor(h.db, org, "contable");
    expect(
      await catchErr(createEvent(h.db, c, { type: "call", title: "Llamar", startsAt: iso(Date.now()) })),
    ).toBeInstanceOf(ForbiddenError);
  });

  it("los listados respetan el alcance: el agente B no ve la agenda del A; el supervisor del equipo sí", async () => {
    const a = await ctxFor(h.db, org, "agenteA");
    const b = await ctxFor(h.db, org, "agenteB");
    const s = await ctxFor(h.db, org, "supervisor");
    const mine = await createEvent(h.db, a, {
      type: "meeting",
      title: "Reunión con el dueño",
      startsAt: iso(Date.now() + 4 * HOUR),
    });
    const range = { from: iso(Date.now() - 24 * HOUR), to: iso(Date.now() + 48 * HOUR) };
    expect((await listEvents(h.db, a, range)).some((e) => e.id === mine.id)).toBe(true);
    expect((await listEvents(h.db, b, range)).some((e) => e.id === mine.id)).toBe(false);
    expect((await listEvents(h.db, s, range)).some((e) => e.id === mine.id)).toBe(true);
    expect(await catchErr(getEvent(h.db, b, mine.id))).toBeInstanceOf(NotFoundError);
    expect(
      await catchErr(updateEvent(h.db, b, { ...mine, id: mine.id, startsAt: iso(Date.now()) })),
    ).toBeInstanceOf(NotFoundError);
  });

  it("no se puede vincular una propiedad o contacto de otra organización", async () => {
    const other = await createTestOrg(h.db, "agenda-otra", { agente: { roleKey: "agent" } });
    const ctx = await ctxFor(h.db, other, "agente");
    expect(await catchErr(createEvent(h.db, ctx, visit()))).toBeInstanceOf(NotFoundError);
  });

  it("cerrar una visita exige resultado, registra el timeline y emite visit.completed", async () => {
    const ctx = await ctxFor(h.db, org, "agenteA");
    const e = await createEvent(h.db, ctx, visit());
    expect(await catchErr(closeEvent(h.db, ctx, { id: e.id, status: "done" }))).toBeInstanceOf(
      ValidationError,
    );
    const closed = await closeEvent(h.db, ctx, {
      id: e.id,
      status: "done",
      outcome: "offer_intent",
      rating: 4,
      feedback: "Le encantó el living, pide segunda visita con la pareja",
    });
    expect(closed?.status).toBe("done");
    expect(closed?.closedAt).toBeInstanceOf(Date);
    const acts = await h.db
      .select()
      .from(activity)
      .where(and(eq(activity.contactId, contactId), eq(activity.type, "visit")));
    expect(acts.length).toBeGreaterThan(0);
    const evts = await h.db.select().from(domainEvent).where(eq(domainEvent.aggregateId, e.id));
    expect(evts.map((x) => x.type)).toContain("visit.completed");
    expect(await catchErr(closeEvent(h.db, ctx, { id: e.id, status: "cancelled" }))).toBeInstanceOf(
      ConflictError,
    );
    expect(await catchErr(updateEvent(h.db, ctx, { ...visit(), id: e.id }))).toBeInstanceOf(ConflictError);
  });

  it("solo las visitas llevan resultado", async () => {
    const ctx = await ctxFor(h.db, org, "agenteA");
    const e = await createEvent(h.db, ctx, {
      type: "call",
      title: "Llamar a Clara",
      startsAt: iso(Date.now()),
      contactId,
    });
    expect(
      await catchErr(closeEvent(h.db, ctx, { id: e.id, status: "done", outcome: "interested" })),
    ).toBeInstanceOf(ValidationError);
    const closed = await closeEvent(h.db, ctx, {
      id: e.id,
      status: "done",
      feedback: "Atendió, manda documentos",
    });
    expect(closed?.outcome).toBeNull();
  });

  it("la base rechaza un resultado en eventos que no son visitas", async () => {
    const ctx = await ctxFor(h.db, org, "agenteA");
    const e = await createEvent(h.db, ctx, {
      type: "task",
      title: "Preparar carpeta",
      startsAt: iso(Date.now()),
    });
    await expect(
      h.db.execute(sql`update calendar_event set outcome = 'interested' where id = ${e.id}`),
    ).rejects.toThrow();
  });

  it("reprogramar un evento cancelado lo vuelve a agendar", async () => {
    const ctx = await ctxFor(h.db, org, "agenteA");
    const e = await createEvent(h.db, ctx, visit());
    await closeEvent(h.db, ctx, { id: e.id, status: "no_show" });
    const re = await reopenEvent(h.db, ctx, { id: e.id, startsAt: iso(Date.now() + 26 * HOUR) });
    expect(re?.status).toBe("scheduled");
    expect(re?.closedAt).toBeNull();
    expect(await catchErr(reopenEvent(h.db, ctx, { id: e.id, startsAt: iso(Date.now()) }))).toBeInstanceOf(
      ConflictError,
    );
  });

  it("dashboard: agenda de hoy y visitas vencidas sin cerrar", async () => {
    const ctx = await ctxFor(h.db, org, "agenteA");
    const past = await createEvent(
      h.db,
      ctx,
      visit({ startsAt: iso(Date.now() - 30 * HOUR), endsAt: iso(Date.now() - 29 * HOUR) }),
    );
    const ov = await agendaOverview(h.db, ctx);
    expect(ov).not.toBeNull();
    expect(ov?.pendingClose.some((e) => e.id === past.id)).toBe(true);
    expect(ov?.pendingVisits).toBeGreaterThan(0);
    expect(ov?.upcoming7Days).toBeGreaterThan(0);
    const b = await ctxFor(h.db, org, "agenteB");
    const ovB = await agendaOverview(h.db, b);
    expect(ovB?.pendingClose.some((e) => e.id === past.id)).toBe(false);
  });

  it("ficha de contacto: próximos y pasados", async () => {
    const ctx = await ctxFor(h.db, org, "agenteA");
    const r = await eventsFor(h.db, ctx, { contactId });
    expect(r?.upcoming.length).toBeGreaterThan(0);
    expect(r?.past.length).toBeGreaterThan(0);
  });

  it("baja lógica", async () => {
    const ctx = await ctxFor(h.db, org, "agenteA");
    const e = await createEvent(h.db, ctx, {
      type: "reminder",
      title: "Renovar exclusividad",
      startsAt: iso(Date.now()),
    });
    await deleteEvent(h.db, ctx, e.id);
    const [row] = await h.db.select().from(calendarEvent).where(eq(calendarEvent.id, e.id));
    expect(row?.deletedAt).toBeInstanceOf(Date);
    expect(await catchErr(getEvent(h.db, ctx, e.id))).toBeInstanceOf(NotFoundError);
  });
});
