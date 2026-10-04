import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  automationRun,
  calendarEvent,
  contactTag,
  inquiry,
  lead,
  notification,
  tag,
  type DbHandle,
} from "@crm/db";
import {
  botRespond,
  createLead,
  dispatchAutomations,
  executeRule,
  ForbiddenError,
  getBotSettings,
  listNotifications,
  listRuns,
  markNotificationsRead,
  runScheduledAutomations,
  saveBotSettings,
  saveRule,
  setRuleEnabled,
  unreadNotificationsCount,
} from "../src";
import { loadSubject } from "../src/automations/facts";
import { createTestOrg, ctxFor, freshDb, type TestOrg } from "./fixtures";

let h: DbHandle;
let org: TestOrg;

async function catchErr(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => null,
    (e: unknown) => e,
  );
}

async function drain() {
  while ((await dispatchAutomations(h.db, 50)) > 0) {
    /* entregar todo */
  }
}

beforeAll(async () => {
  h = await freshDb();
  org = await createTestOrg(h.db, "auto", {
    admin: { roleKey: "admin" },
    agenteA: { roleKey: "agent", inTeam: true },
    agenteB: { roleKey: "agent", inTeam: true },
    recepcion: { roleKey: "reception" },
  });
  await drain(); // eventos del alta de la organización
});
afterAll(async () => {
  await h.pool.end();
});

const newLead = async (who: "agenteA" | "agenteB", source: string, first = "Cli") => {
  const ctx = await ctxFor(h.db, org, who);
  return (
    await createLead(h.db, ctx, {
      operation: "buy",
      source,
      contact: { firstName: first, lastName: "Ente", phone: `09${Math.floor(1e6 + Math.random() * 8e6)}` },
    })
  ).lead;
};

describe("automatizaciones por evento", () => {
  it("solo administración las gestiona", async () => {
    const a = await ctxFor(h.db, org, "agenteA");
    expect(
      await catchErr(
        saveRule(h.db, a, {
          name: "x",
          trigger: "lead.created",
          actions: [{ type: "notify", to: "assignee", title: "x" }],
        }),
      ),
    ).toBeInstanceOf(ForbiddenError);
  });

  it("condición + notificación + etiqueta; no actúa si no cumple", async () => {
    const admin = await ctxFor(h.db, org, "admin");
    const rule = await saveRule(h.db, admin, {
      name: "Leads de portal",
      trigger: "lead.created",
      conditions: [{ field: "source", op: "eq", value: "portal" }],
      actions: [
        { type: "notify", to: "assignee", title: "Nuevo lead {{codigo}} de {{nombre}}" },
        { type: "tag", tag: "Portal" },
      ],
    });
    const l1 = await newLead("agenteA", "portal", "Ana");
    const l2 = await newLead("agenteA", "phone", "Beto");
    await drain();
    const a = await ctxFor(h.db, org, "agenteA");
    const mine = await listNotifications(h.db, a);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.title).toMatch(/^Nuevo lead LEAD-\d+ de Ana Ente$/);
    expect(mine[0]?.href).toBe(`/crm/leads/${l1.id}`);
    const tags = await h.db
      .select({ contactId: contactTag.contactId })
      .from(contactTag)
      .innerJoin(tag, eq(tag.id, contactTag.tagId))
      .where(eq(tag.name, "Portal"));
    expect(tags.map((t) => t.contactId)).toEqual([l1.contactId]);
    expect(tags.map((t) => t.contactId)).not.toContain(l2.contactId);

    // Otro usuario no ve ni marca notificaciones ajenas.
    const b = await ctxFor(h.db, org, "agenteB");
    expect(await unreadNotificationsCount(h.db, b)).toBe(0);
    await markNotificationsRead(h.db, b);
    expect(await unreadNotificationsCount(h.db, a)).toBe(1);
    await markNotificationsRead(h.db, a, [mine[0]?.id ?? ""]);
    expect(await unreadNotificationsCount(h.db, a)).toBe(0);

    const runs = await listRuns(h.db, admin, { ruleId: rule.id });
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe("success");
    await setRuleEnabled(h.db, admin, rule.id, false);
  });

  it("rueda de asignación, sin encadenar automatizaciones y sin repetir", async () => {
    const admin = await ctxFor(h.db, org, "admin");
    const A = org.members.agenteA?.userId ?? "";
    const B = org.members.agenteB?.userId ?? "";
    const rr = await saveRule(h.db, admin, {
      name: "Rueda web",
      trigger: "lead.created",
      conditions: [{ field: "source", op: "eq", value: "website" }],
      actions: [{ type: "assign", userIds: [A, B] }],
    });
    // Esta regla NO debe dispararse por las asignaciones que hace la automatización.
    await saveRule(h.db, admin, {
      name: "Aviso de asignación",
      trigger: "lead.assigned",
      actions: [{ type: "notify", to: "role", roleKey: "reception", title: "Asignado {{codigo}}" }],
    });
    const leads = [];
    for (let i = 0; i < 3; i++) leads.push(await newLead("agenteB", "website", `Web${i}`));
    await drain();
    const assigned = await Promise.all(
      leads.map(async (l) => (await h.db.select().from(lead).where(eq(lead.id, l.id)))[0]?.assignedUserId),
    );
    expect(assigned).toEqual([A, B, A]);
    const recep = await ctxFor(h.db, org, "recepcion");
    expect(await unreadNotificationsCount(h.db, recep)).toBe(0);

    // La misma clave no se ejecuta dos veces.
    const [ruleRow] = await h.db.query.automationRule.findMany({ where: (r, { eq: e }) => e(r.id, rr.id) });
    const subject = await loadSubject(h.db, org.organizationId, "lead", leads[0]?.id ?? "", {
      today: "2026-10-04",
      tz: "America/Montevideo",
    });
    if (!ruleRow || !subject) throw new Error("setup");
    expect(
      await executeRule(h.db, ruleRow, subject, "manual:1", {
        tz: "America/Montevideo",
        today: "2026-10-04",
      }),
    ).not.toBeNull();
    expect(
      await executeRule(h.db, ruleRow, subject, "manual:1", {
        tz: "America/Montevideo",
        today: "2026-10-04",
      }),
    ).toBeNull();
  });
});

describe("automatizaciones programadas", () => {
  it("lead sin contacto: tarea una sola vez por episodio", async () => {
    const admin = await ctxFor(h.db, org, "admin");
    const rule = await saveRule(h.db, admin, {
      name: "Seguimiento",
      trigger: "schedule.lead_stale",
      days: 3,
      conditions: [{ field: "operation", op: "eq", value: "buy" }],
      actions: [{ type: "task", to: "assignee", title: "Llamar a {{nombre}} ({{dias}} días)", dueInDays: 0 }],
    });
    await h.db.update(lead).set({ status: "won" }).where(eq(lead.organizationId, org.organizationId));
    const l = await newLead("agenteA", "referral", "Viejo");
    await h.db
      .update(lead)
      .set({ lastContactAt: new Date(Date.now() - 5 * 86_400_000) })
      .where(eq(lead.id, l.id));
    const r1 = await runScheduledAutomations(h.db, { organizationId: org.organizationId });
    expect(r1.runs).toBe(1);
    const r2 = await runScheduledAutomations(h.db, { organizationId: org.organizationId });
    expect(r2.runs).toBe(0);
    const tasks = await h.db
      .select()
      .from(calendarEvent)
      .where(and(eq(calendarEvent.leadId, l.id), eq(calendarEvent.type, "task")));
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.title).toBe("Llamar a Viejo Ente (5 días)");
    expect(tasks[0]?.assignedUserId).toBe(org.members.agenteA?.userId);
    // La tarea creada por la automatización no dispara otras reglas.
    await drain();
    const [run] = await h.db.select().from(automationRun).where(eq(automationRun.ruleId, rule.id));
    expect(run?.status).toBe("success");
  });
});

describe("disparadores programados sin candidatos", () => {
  it("las consultas de cada disparador programado son válidas", async () => {
    const admin = await ctxFor(h.db, org, "admin");
    for (const trigger of [
      "schedule.charge_overdue",
      "schedule.contract_ending",
      "schedule.reservation_expiring",
      "schedule.publication_expiring",
    ])
      await saveRule(h.db, admin, {
        name: `Prueba ${trigger}`,
        trigger,
        days: 3,
        actions: [{ type: "notify", to: "assignee", title: "x {{codigo}}" }],
      });
    const r = await runScheduledAutomations(h.db, { organizationId: org.organizationId });
    expect(r.rules).toBeGreaterThanOrEqual(5);
  });
});

describe("asistente virtual", () => {
  it("responde preguntas, deriva a la bandeja y dispara la regla de consultas", async () => {
    const admin = await ctxFor(h.db, org, "admin");
    const s = await getBotSettings(h.db, admin);
    expect(await botRespond(h.db, s.token, { type: "start" })).toBeNull(); // apagado
    await saveBotSettings(h.db, admin, {
      enabled: true,
      greeting: "Hola!",
      handoffMessage: "Te llamamos",
      faqs: [
        {
          question: "¿Aceptan mascotas?",
          keywords: "mascota, perro, gato",
          answer: "Depende de cada propietario.",
        },
      ],
    });
    await saveRule(h.db, admin, {
      name: "Consulta del bot",
      trigger: "inquiry.created",
      conditions: [{ field: "channel", op: "eq", value: "bot" }],
      actions: [{ type: "notify", to: "role", roleKey: "reception", title: "Consulta de {{nombre}}" }],
    });
    const start = await botRespond(h.db, s.token, { type: "start" });
    expect(start?.messages).toEqual(["Hola!"]);
    expect(
      (await botRespond(h.db, s.token, { type: "message", text: "¿aceptan perros?" }))?.messages,
    ).toEqual(["Depende de cada propietario."]);
    const unknown = await botRespond(h.db, s.token, { type: "message", text: "qwerty" });
    expect(unknown?.quick?.some((q) => "contact" in q)).toBe(true);
    const search = await botRespond(h.db, s.token, { type: "search", operation: "sale" });
    expect(search?.messages[0]).toContain("No encontré");
    const done = await botRespond(h.db, s.token, {
      type: "handoff",
      name: "Laura",
      phone: "099123456",
      message: "Quiero tasar",
    });
    expect(done).toMatchObject({ messages: ["Te llamamos"], done: true });
    const [q] = await h.db.select().from(inquiry).where(eq(inquiry.organizationId, org.organizationId));
    expect(q).toMatchObject({ channel: "bot", name: "Laura", status: "open" });
    await drain();
    const recep = await ctxFor(h.db, org, "recepcion");
    const n = await listNotifications(h.db, recep);
    expect(n.map((x) => x.title)).toEqual(["Consulta de Laura"]);
    expect(await botRespond(h.db, "0".repeat(48), { type: "start" })).toBeNull();
    const all = await h.db
      .select()
      .from(notification)
      .where(eq(notification.organizationId, org.organizationId));
    expect(all.length).toBeGreaterThan(0);
  });
});
