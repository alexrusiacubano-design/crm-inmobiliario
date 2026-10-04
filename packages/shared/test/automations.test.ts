import { describe, expect, it } from "vitest";
import {
  DEFAULT_BOT_FAQS,
  automationRuleSchema,
  evaluateConditions,
  extractPropertyCode,
  isSafeWebhookUrl,
  matchFaq,
  nextInRotation,
  renderAutomationText,
} from "../src";

describe("condiciones", () => {
  const facts = { operation: "buy", source: "portal", hasAssignee: false, daysWithoutContact: 4, x: null };
  it("evalúa enum, booleano y número con Y", () => {
    expect(evaluateConditions([], facts)).toBe(true);
    expect(evaluateConditions([{ field: "operation", op: "eq", value: "buy" }], facts)).toBe(true);
    expect(evaluateConditions([{ field: "source", op: "neq", value: "portal" }], facts)).toBe(false);
    expect(evaluateConditions([{ field: "hasAssignee", op: "eq", value: "false" }], facts)).toBe(true);
    expect(
      evaluateConditions(
        [
          { field: "daysWithoutContact", op: "gte", value: "3" },
          { field: "daysWithoutContact", op: "lte", value: 4 },
        ],
        facts,
      ),
    ).toBe(true);
    expect(evaluateConditions([{ field: "daysWithoutContact", op: "gte", value: 5 }], facts)).toBe(false);
    expect(evaluateConditions([{ field: "x", op: "eq", value: "a" }], facts)).toBe(false);
    expect(evaluateConditions([{ field: "nope", op: "neq", value: "a" }], facts)).toBe(true);
  });
});

describe("textos y rueda", () => {
  it("reemplaza variables conocidas y deja las desconocidas", () => {
    expect(
      renderAutomationText("Lead {{codigo}} de {{ nombre }} ({{x}}) {{dias}}", {
        codigo: "LEAD-1",
        nombre: "Ana",
      }),
    ).toBe("Lead LEAD-1 de Ana ({{x}}) —");
  });
  it("rota usuarios", () => {
    expect(nextInRotation(["a", "b", "c"], null)).toBe("a");
    expect(nextInRotation(["a", "b", "c"], "a")).toBe("b");
    expect(nextInRotation(["a", "b", "c"], "c")).toBe("a");
    expect(nextInRotation(["a", "b"], "z")).toBe("a");
    expect(nextInRotation([], "a")).toBeNull();
  });
});

describe("webhooks seguros", () => {
  it("solo https público", () => {
    expect(isSafeWebhookUrl("https://hooks.zapier.com/hooks/catch/1/abc")).toBe(true);
    expect(isSafeWebhookUrl("https://example.com:8443/x?y=1")).toBe(true);
    expect(isSafeWebhookUrl("http://example.com")).toBe(false);
    expect(isSafeWebhookUrl("https://localhost/x")).toBe(false);
    expect(isSafeWebhookUrl("https://10.0.0.5/x")).toBe(false);
    expect(isSafeWebhookUrl("https://192.168.1.2")).toBe(false);
    expect(isSafeWebhookUrl("https://169.254.169.254/latest")).toBe(false);
    expect(isSafeWebhookUrl("https://user:pw@example.com")).toBe(false);
    expect(isSafeWebhookUrl("https://[::1]/")).toBe(false);
  });
});

describe("regla", () => {
  const base = {
    name: "Aviso de lead",
    trigger: "lead.created",
    actions: [{ type: "notify", to: "assignee", title: "Nuevo lead {{codigo}}" }],
  };
  it("valida campos, acciones por entidad, variables y días", () => {
    expect(automationRuleSchema.safeParse(base).success).toBe(true);
    expect(
      automationRuleSchema.safeParse({ ...base, conditions: [{ field: "channel", op: "eq", value: "web" }] })
        .success,
    ).toBe(false);
    expect(
      automationRuleSchema.safeParse({ ...base, conditions: [{ field: "operation", op: "eq", value: "x" }] })
        .success,
    ).toBe(false);
    expect(
      automationRuleSchema.safeParse({
        ...base,
        actions: [{ type: "notify", to: "assignee", title: "{{foo}}" }],
      }).success,
    ).toBe(false);
    expect(
      automationRuleSchema.safeParse({
        ...base,
        trigger: "deal.closed",
        actions: [{ type: "assign", userIds: [] }],
      }).success,
    ).toBe(false);
    expect(automationRuleSchema.safeParse({ ...base, trigger: "schedule.lead_stale" }).success).toBe(false);
    expect(automationRuleSchema.safeParse({ ...base, trigger: "schedule.lead_stale", days: 3 }).success).toBe(
      true,
    );
    expect(
      automationRuleSchema.safeParse({ ...base, actions: [{ type: "webhook", url: "http://x.com" }] })
        .success,
    ).toBe(false);
  });
});

describe("asistente", () => {
  it("encuentra la pregunta frecuente por palabras clave sin tildes", () => {
    expect(matchFaq("¿Qué GARANTÍAS aceptan?", DEFAULT_BOT_FAQS)?.question).toContain("garantías");
    expect(matchFaq("a qué hora abren", DEFAULT_BOT_FAQS)?.question).toContain("horario");
    expect(matchFaq("quiero vender mi casa, cuánto vale", DEFAULT_BOT_FAQS)?.question).toContain(
      "tasaciones",
    );
    expect(matchFaq("hola", DEFAULT_BOT_FAQS)).toBeNull();
  });
  it("reconoce códigos de propiedad", () => {
    expect(extractPropertyCode("info de la PROP-000012 por favor")).toBe("PROP-000012");
    expect(extractPropertyCode("propiedad 7")).toBe("PROP-000007");
    expect(extractPropertyCode("prop#45")).toBe("PROP-000045");
    expect(extractPropertyCode("propuesta")).toBeNull();
  });
});

describe("plantillas de reglas", () => {
  it("todas validan (la rueda pide elegir usuarios)", async () => {
    const { RULE_TEMPLATES } = await import("../src");
    for (const t of RULE_TEMPLATES) {
      const r = automationRuleSchema.safeParse({
        name: t.name,
        trigger: t.trigger,
        days: t.days,
        conditions: t.conditions,
        actions: t.actions,
      });
      expect(r.success, t.key).toBe(t.key !== "portal-round-robin");
    }
  });
});
