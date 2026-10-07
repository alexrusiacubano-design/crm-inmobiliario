import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { activity, type DbHandle } from "@crm/db";
import {
  ConflictError,
  createContact,
  emailConfigured,
  sendEmail,
  sendEmailToContact,
  textToHtml,
} from "../src";
import { createTestOrg, ctxFor, freshDb, type TestOrg } from "./fixtures";

let h: DbHandle;
let org: TestOrg;

beforeAll(async () => {
  h = await freshDb();
  org = await createTestOrg(h.db, "mail", { agente: { roleKey: "agent", inTeam: true } });
});
afterAll(async () => {
  await h.pool.end();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("email", () => {
  it("convierte texto a HTML escapado con enlaces", () => {
    expect(textToHtml("Hola <b>Ana</b>\n\nVer https://x.com/a?b=1")).toContain("&lt;b&gt;Ana&lt;/b&gt;");
    expect(textToHtml("Ver https://x.com/a")).toContain('<a href="https://x.com/a">');
  });

  it("sin configuración no envía; con Resend envía y registra en el timeline", async () => {
    expect(emailConfigured()).toBe(false);
    await expect(sendEmail({ to: "a@b.com", subject: "x", text: "y" })).rejects.toBeInstanceOf(ConflictError);

    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "Inmo <avisos@inmo.com.uy>");
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { body: string }) => {
        calls.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
        return new Response(JSON.stringify({ id: "em_1" }), { status: 200 });
      }),
    );
    const a = await ctxFor(h.db, org, "agente");
    const c = (
      await createContact(h.db, a, {
        firstName: "Ana",
        lastName: "Cliente",
        channels: [{ type: "email", value: "ana@example.com", isPrimary: true }],
      })
    ).contact;
    const r = await sendEmailToContact(h.db, a, {
      contactId: c.id,
      subject: "Hola",
      body: "Te escribo por la casa.",
    });
    expect(r).toMatchObject({ id: "em_1", to: "ana@example.com" });
    expect(calls[0]?.url).toBe("https://api.resend.com/emails");
    expect(calls[0]?.body).toMatchObject({
      from: "Inmo <avisos@inmo.com.uy>",
      to: ["ana@example.com"],
      subject: "Hola",
    });
    const acts = await h.db.select().from(activity).where(eq(activity.contactId, c.id));
    expect(acts.some((x) => x.type === "email" && x.body?.startsWith("Hola"))).toBe(true);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ message: "dominio no verificado" }), { status: 422 })),
    );
    await expect(sendEmail({ to: "a@b.com", subject: "x", text: "y" })).rejects.toThrow(
      "dominio no verificado",
    );
  });
});
