import { describe, expect, it } from "vitest";
import {
  canTransitionLead,
  formatCI,
  isValidUruguayanCI,
  mask,
  normalizeDocument,
  normalizePhone,
  normalizeText,
} from "../src";
import { contactInputSchema, searchProfileSchema } from "../src/validation/crm";

describe("normalización", () => {
  it("teléfonos uruguayos a E.164", () => {
    expect(normalizePhone("099 123 456")).toBe("+59899123456");
    expect(normalizePhone("99123456")).toBe("+59899123456");
    expect(normalizePhone("+598 99 123 456")).toBe("+59899123456");
    expect(normalizePhone("00598 99123456")).toBe("+59899123456");
    expect(normalizePhone("2710 1234")).toBe("+59827101234");
    expect(normalizePhone("4222-1234")).toBe("+59842221234");
    expect(normalizePhone("+54 9 11 5555 1234")).toBe("+5491155551234");
    expect(normalizePhone("123")).toBeNull();
  });

  it("valida el dígito verificador de la cédula", () => {
    expect(isValidUruguayanCI("1.234.567-2")).toBe(true);
    expect(isValidUruguayanCI("12345672")).toBe(true);
    expect(isValidUruguayanCI("1.234.567-3")).toBe(false);
    expect(isValidUruguayanCI("123")).toBe(false);
    expect(formatCI(normalizeDocument("ci", "1.234.567-2"))).toBe("1.234.567-2");
  });

  it("texto sin tildes y enmascarado", () => {
    expect(normalizeText("  Pérez   NÚÑEZ ")).toBe("perez nunez");
    expect(mask("001234567890")).toBe("••••••••7890");
  });
});

describe("embudo de leads", () => {
  it("permite avanzar, retroceder entre etapas abiertas, perder y reabrir", () => {
    expect(canTransitionLead("new", "qualified")).toBe(true);
    expect(canTransitionLead("visit", "contacted")).toBe(true);
    expect(canTransitionLead("offer", "lost")).toBe(true);
    expect(canTransitionLead("lost", "new")).toBe(true);
  });

  it("no permite cerrar sin reserva ni reabrir un cerrado", () => {
    expect(canTransitionLead("new", "won")).toBe(false);
    expect(canTransitionLead("reservation", "won")).toBe(true);
    expect(canTransitionLead("won", "new")).toBe(false);
    expect(canTransitionLead("lost", "offer")).toBe(false);
    expect(canTransitionLead("new", "new")).toBe(false);
  });
});

describe("esquemas CRM", () => {
  it("exige nombre a personas y razón social a empresas", () => {
    expect(contactInputSchema.safeParse({ kind: "person" }).success).toBe(false);
    expect(contactInputSchema.safeParse({ kind: "company", companyName: "Inmo SA" }).success).toBe(true);
  });

  it("rechaza cédulas inválidas y canales mal formados", () => {
    const bad = contactInputSchema.safeParse({
      firstName: "Ana",
      documentType: "ci",
      documentNumber: "1.234.567-3",
    });
    expect(bad.success).toBe(false);
    const badPhone = contactInputSchema.safeParse({
      firstName: "Ana",
      channels: [{ type: "phone", value: "12" }],
    });
    expect(badPhone.success).toBe(false);
  });

  it("valida que el precio mínimo no supere al máximo", () => {
    const r = searchProfileSchema.safeParse({ operation: "buy", priceMin: "300.000", priceMax: "200.000" });
    expect(r.success).toBe(false);
  });
});
