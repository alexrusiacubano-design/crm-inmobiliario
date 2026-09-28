import { describe, expect, it } from "vitest";
import {
  canTransitionAcquisition,
  canTransitionProperty,
  formatBasisPoints,
  parsePercentToBasisPoints,
  publishChecklist,
  sniffMimeType,
} from "../src";
import { setOwnersSchema, valuationInputSchema, videoLinkSchema } from "../src/validation/property";

const bytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

const complete = {
  title: "Apartamento 2 dormitorios en Pocitos",
  description: "Luminoso, a dos cuadras de la rambla, con balcón al frente y garaje.",
  localityId: 1,
  operations: ["sale"],
  listPrices: [{ operation: "sale", hasListPrice: true }],
  photoCount: 3,
  hasCover: true,
  ownerShareTotal: 10_000,
  ownerCount: 1,
};

describe("checklist de publicación", () => {
  it("vacío cuando la ficha está completa", () => {
    expect(publishChecklist(complete)).toEqual([]);
  });
  it("lista cada faltante", () => {
    const missing = publishChecklist({
      ...complete,
      title: "Corto",
      operations: ["sale", "rent"],
      photoCount: 2,
      hasCover: false,
      ownerShareTotal: 5_000,
    });
    expect(missing).toContain("Título de al menos 8 caracteres");
    expect(missing).toContain("Precio publicado de Alquiler");
    expect(missing).toContain("Al menos 3 fotos");
    expect(missing).toContain("Foto de portada");
    expect(missing).toContain("Participaciones de propietarios que sumen 100 %");
  });
  it("sin propietarios no se publica", () => {
    expect(publishChecklist({ ...complete, ownerCount: 0, ownerShareTotal: 0 })).toEqual(["Propietario"]);
  });
});

describe("transiciones", () => {
  it("propiedad", () => {
    expect(canTransitionProperty("draft", "published")).toBe(true);
    expect(canTransitionProperty("sold", "published")).toBe(false);
    expect(canTransitionProperty("withdrawn", "draft")).toBe(true);
    expect(canTransitionProperty("withdrawn", "published")).toBe(false);
  });
  it("captación", () => {
    expect(canTransitionAcquisition("prospect", "valuation")).toBe(true);
    expect(canTransitionAcquisition("negotiation", "captured")).toBe(false);
    expect(canTransitionAcquisition("authorization", "captured")).toBe(true);
    expect(canTransitionAcquisition("captured", "published")).toBe(false);
    expect(canTransitionAcquisition("captured", "lost")).toBe(false);
    expect(canTransitionAcquisition("lost", "prospect")).toBe(true);
    expect(canTransitionAcquisition("lost", "negotiation")).toBe(false);
  });
});

describe("porcentajes en puntos básicos", () => {
  it("parsea con coma o punto", () => {
    expect(parsePercentToBasisPoints("3")).toBe(300);
    expect(parsePercentToBasisPoints("3,5")).toBe(350);
    expect(parsePercentToBasisPoints("33.33 %")).toBe(3333);
    expect(parsePercentToBasisPoints("100")).toBe(10_000);
  });
  it("rechaza valores inválidos", () => {
    expect(() => parsePercentToBasisPoints("101")).toThrow();
    expect(() => parsePercentToBasisPoints("1,234")).toThrow();
    expect(() => parsePercentToBasisPoints("-2")).toThrow();
  });
  it("formatea", () => {
    expect(formatBasisPoints(350)).toBe("3,5 %");
    expect(formatBasisPoints(10_000)).toBe("100 %");
    expect(formatBasisPoints(3333)).toBe("33,33 %");
  });
});

describe("tipo de archivo por contenido", () => {
  it("detecta firmas conocidas", () => {
    expect(sniffMimeType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffMimeType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      "image/png",
    );
    expect(sniffMimeType(bytes("%PDF-1.7"))).toBe("application/pdf");
    expect(sniffMimeType(bytes("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
  });
  it("no confía en contenido desconocido", () => {
    expect(sniffMimeType(bytes("<script>alert(1)</script>"))).toBeNull();
    expect(sniffMimeType(new Uint8Array())).toBeNull();
  });
});

describe("validaciones", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const id2 = "00000000-0000-4000-8000-000000000002";
  it("propietarios deben sumar 100 % y no repetirse", () => {
    expect(
      setOwnersSchema.safeParse({
        propertyId: id,
        owners: [
          { contactId: id, sharePercent: "50" },
          { contactId: id2, sharePercent: "50" },
        ],
      }).success,
    ).toBe(true);
    expect(
      setOwnersSchema.safeParse({
        propertyId: id,
        owners: [
          { contactId: id, sharePercent: "60" },
          { contactId: id2, sharePercent: "30" },
        ],
      }).success,
    ).toBe(false);
    expect(
      setOwnersSchema.safeParse({
        propertyId: id,
        owners: [
          { contactId: id, sharePercent: "50" },
          { contactId: id, sharePercent: "50" },
        ],
      }).success,
    ).toBe(false);
  });
  it("videos solo de YouTube o Vimeo", () => {
    expect(
      videoLinkSchema.safeParse({ propertyId: id, url: "https://www.youtube.com/watch?v=abc" }).success,
    ).toBe(true);
    expect(
      videoLinkSchema.safeParse({ propertyId: id, url: "https://evil.example.com/video.mp4" }).success,
    ).toBe(false);
  });
  it("tasación con destino y rango coherente", () => {
    expect(
      valuationInputSchema.safeParse({ method: "comparables", value: "100.000", valuedAt: "2026-01-01" })
        .success,
    ).toBe(false);
    expect(
      valuationInputSchema.safeParse({
        propertyId: id,
        method: "comparables",
        value: "100.000",
        min: "120.000",
        max: "110.000",
        valuedAt: "2026-01-01",
      }).success,
    ).toBe(false);
  });
});
