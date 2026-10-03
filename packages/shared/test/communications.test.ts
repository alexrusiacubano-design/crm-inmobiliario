import { describe, expect, it } from "vitest";
import { renderTemplate, unknownVariables } from "../src/communications";
import { createInquirySchema, templateSchema } from "../src/validation/communications";

describe("plantillas", () => {
  it("reemplaza variables y marca las vacías", () => {
    expect(
      renderTemplate("Hola {{nombre}}, soy {{ agente }}. {{precio}}", { nombre: "Ana", agente: "Martín" }),
    ).toBe("Hola Ana, soy Martín. …");
    expect(renderTemplate("{{otra}}", {})).toBe("{{otra}}");
    expect(unknownVariables("{{nombre}} {{foo}} {{Bar}}")).toEqual(["foo", "bar"]);
  });
  it("no deja guardar variables desconocidas", () => {
    expect(
      templateSchema.safeParse({ name: "Saludo", channel: "whatsapp", body: "Hola {{cliente}}" }).success,
    ).toBe(false);
    expect(
      templateSchema.safeParse({ name: "Saludo", channel: "whatsapp", body: "Hola {{nombre}}" }).success,
    ).toBe(true);
  });
});

describe("consultas", () => {
  it("exige teléfono o email", () => {
    expect(createInquirySchema.safeParse({ message: "Hola" }).success).toBe(false);
    expect(createInquirySchema.safeParse({ message: "Hola", email: "A@B.com" }).success).toBe(true);
  });
});
