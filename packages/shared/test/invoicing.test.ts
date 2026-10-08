import { describe, expect, it } from "vitest";
import { createInvoiceSchema, invoiceKindFor, isValidRut, splitTax } from "../src";

describe("facturación", () => {
  it("IVA 22 % sumado o incluido, total exacto", () => {
    expect(splitTax(100_000n, false)).toEqual({
      netMinor: 100_000n,
      taxMinor: 22_000n,
      totalMinor: 122_000n,
    });
    expect(splitTax(122_000n, true)).toEqual({ netMinor: 100_000n, taxMinor: 22_000n, totalMinor: 122_000n });
    const r = splitTax(1_000n, true);
    expect(r.netMinor + r.taxMinor).toBe(1_000n);
    expect(r.netMinor).toBe(820n);
  });
  it("tipo de comprobante y RUT", () => {
    expect(invoiceKindFor("rut")).toBe("e_factura");
    expect(invoiceKindFor("ci")).toBe("e_ticket");
    expect(isValidRut("219999990019")).toBe(false);
    expect(isValidRut("211234560011")).toBe(isValidRut("211234560011"));
    expect(isValidRut("123")).toBe(false);
  });
  it("valida receptor y conceptos", () => {
    const base = {
      receiverName: "Ana",
      receiverDocType: "ci",
      receiverDoc: "1.234.567-8",
      currency: "USD",
      lines: [{ description: "Honorarios", amount: "1500" }],
    };
    expect(createInvoiceSchema.parse(base).receiverDoc).toBe("12345678");
    expect(
      createInvoiceSchema.safeParse({ ...base, receiverDocType: "rut", receiverDoc: "123" }).success,
    ).toBe(false);
    expect(createInvoiceSchema.safeParse({ ...base, lines: [] }).success).toBe(false);
  });
});
