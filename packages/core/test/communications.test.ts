import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activity, inquiry, type DbHandle } from "@crm/db";
import {
  actOnInquiry,
  composeContext,
  ConflictError,
  conversationMessages,
  convertInquiry,
  createInquiry,
  createLead,
  ForbiddenError,
  ingestInquiry,
  listConversations,
  listInquiries,
  listTemplates,
  logOutbound,
  NotFoundError,
  openInquiriesCount,
  saveTemplate,
  sendChatMessage,
  startConversation,
  unreadChatCount,
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
  org = await createTestOrg(h.db, "comms", {
    admin: { roleKey: "admin" },
    agenteA: { roleKey: "agent", inTeam: true },
    agenteB: { roleKey: "agent", branch: "second" },
    recepcion: { roleKey: "reception" },
    contable: { roleKey: "accounting" },
  });
});
afterAll(async () => {
  await h.pool.end();
});

describe("bandeja de consultas", () => {
  it("entra por webhook (idempotente), se toma y se convierte en lead reutilizando el contacto", async () => {
    const a = await ctxFor(h.db, org, "agenteA");
    const { lead: existing } = await createLead(h.db, a, {
      operation: "buy",
      source: "portal",
      contact: { firstName: "Ya", lastName: "Existe", channels: [{ type: "phone", value: "099 111 222" }] },
    });
    const r1 = await ingestInquiry(h.db, org.organizationId, {
      channel: "web",
      name: "Ya Existe",
      phone: "099111222",
      message: "Quiero ver el apto",
      externalRef: "form-1",
    });
    expect(r1.inquiry.contactId).toBe(existing.contactId);
    const r2 = await ingestInquiry(h.db, org.organizationId, {
      channel: "web",
      phone: "099111222",
      message: "Quiero ver el apto",
      externalRef: "form-1",
    });
    expect(r2.duplicate).toBe(true);

    const b = await ctxFor(h.db, org, "agenteB");
    expect((await listInquiries(h.db, b, { status: "open" })).items.some((i) => i.id === r1.inquiry.id)).toBe(
      true,
    );
    await actOnInquiry(h.db, a, { id: r1.inquiry.id, action: "take" });
    expect(await catchErr(actOnInquiry(h.db, b, { id: r1.inquiry.id, action: "take" }))).toBeInstanceOf(
      NotFoundError,
    ); // ya es de otro
    const conv = await convertInquiry(h.db, a, { id: r1.inquiry.id, operation: "buy" });
    expect(conv.inquiry?.status).toBe("resolved");
    expect(conv.inquiry?.contactId).toBe(existing.contactId);
    expect(await catchErr(convertInquiry(h.db, a, { id: r1.inquiry.id, operation: "buy" }))).toBeInstanceOf(
      ConflictError,
    );
  });

  it("recepción carga y asigna; descartar exige motivo; contadores", async () => {
    const rec = await ctxFor(h.db, org, "recepcion");
    const a = await ctxFor(h.db, org, "agenteA");
    const i = await createInquiry(h.db, rec, {
      channel: "phone",
      name: "Nuevo Cliente",
      phone: "098765432",
      message: "Busca alquiler",
    });
    expect((await openInquiriesCount(h.db, rec))?.open).toBeGreaterThanOrEqual(1);
    expect(await catchErr(actOnInquiry(h.db, rec, { id: i.id, action: "reject" }))).toBeInstanceOf(
      ValidationError,
    );
    const admin = await ctxFor(h.db, org, "admin");
    await actOnInquiry(h.db, admin, { id: i.id, action: "assign", assignedUserId: a.userId });
    expect((await openInquiriesCount(h.db, a))?.mine).toBe(1);
    const conv = await convertInquiry(h.db, a, { id: i.id, operation: "rent" });
    expect(conv.leadId).toBeTruthy();
    await expect(
      h.db.execute(sql`update inquiry set status = 'resolved', closed_at = null where id = ${i.id}`),
    ).rejects.toThrow();
    const cont = await ctxFor(h.db, org, "contable");
    expect(await catchErr(listInquiries(h.db, cont))).toBeInstanceOf(ForbiddenError);
    const [row] = await h.db.select().from(inquiry).where(eq(inquiry.id, i.id));
    expect(row?.assignedUserId).toBe(a.userId);
  });
});

describe("chat interno", () => {
  it("directas sin duplicar, grupos con nombre, no leídos y privacidad", async () => {
    const a = await ctxFor(h.db, org, "agenteA");
    const b = await ctxFor(h.db, org, "agenteB");
    const rec = await ctxFor(h.db, org, "recepcion");
    const d1 = await startConversation(h.db, a, { memberIds: [b.userId] });
    const d2 = await startConversation(h.db, b, { memberIds: [a.userId] });
    expect(d2.id).toBe(d1.id);
    await sendChatMessage(h.db, a, { conversationId: d1.id, body: "¿Tenés la llave del apto de Pocitos?" });
    expect(await unreadChatCount(h.db, b)).toBe(1);
    expect((await listConversations(h.db, b))[0]?.title).toBeTruthy();
    const msgs = await conversationMessages(h.db, b, d1.id);
    expect(msgs[0]?.mine).toBe(false);
    expect(await unreadChatCount(h.db, b)).toBe(0);
    expect(await catchErr(conversationMessages(h.db, rec, d1.id))).toBeInstanceOf(NotFoundError);
    expect(await catchErr(startConversation(h.db, a, { memberIds: [b.userId, rec.userId] }))).toBeInstanceOf(
      ValidationError,
    );
    const g = await startConversation(h.db, a, {
      memberIds: [b.userId, rec.userId],
      title: "Guardia del sábado",
    });
    expect(g.isGroup).toBe(true);
    await expect(
      h.db.execute(sql`delete from chat_message where conversation_id = ${d1.id}`),
    ).rejects.toThrow();
  });
});

describe("plantillas", () => {
  it("se crean las sugeridas, se completan variables y lo enviado queda en el timeline", async () => {
    const a = await ctxFor(h.db, org, "agenteA");
    const list = await listTemplates(h.db, a);
    expect(list.length).toBeGreaterThanOrEqual(4);
    expect(
      await catchErr(saveTemplate(h.db, a, { name: "Mía", channel: "whatsapp", body: "Hola {{nombre}}" })),
    ).toBeInstanceOf(ForbiddenError);
    const admin = await ctxFor(h.db, org, "admin");
    await saveTemplate(h.db, admin, {
      name: "Recordatorio de pago",
      channel: "whatsapp",
      body: "Hola {{nombre}}, te recuerdo el alquiler.",
    });
    expect(
      await catchErr(
        saveTemplate(h.db, admin, { name: "Recordatorio de pago", channel: "whatsapp", body: "Otra" }),
      ),
    ).toBeInstanceOf(ConflictError);
    const { lead } = await createLead(h.db, a, {
      operation: "buy",
      source: "portal",
      contact: {
        firstName: "Lucía",
        lastName: "Paz",
        channels: [{ type: "whatsapp", value: "099 333 444" }],
      },
    });
    const c = await composeContext(h.db, a, { contactId: lead.contactId });
    expect(c.values.nombre).toBe("Lucía");
    expect(c.values.inmobiliaria).toBeTruthy();
    expect(c.whatsapp).toContain("99333444");
    await logOutbound(h.db, a, {
      contactId: lead.contactId,
      leadId: lead.id,
      channel: "whatsapp",
      body: "Hola Lucía",
    });
    const acts = await h.db.select().from(activity).where(eq(activity.leadId, lead.id));
    expect(acts.some((x) => x.type === "whatsapp" && x.direction === "outbound")).toBe(true);
  });
});
