import { describe, expect, it } from "vitest";
import { canTransitionGuarantee, guaranteeAlerts } from "../src/guarantees";
import { createGuaranteeSchema } from "../src/validation/guarantees";

describe("garantías", () => {
  it("transiciones del trámite", () => {
    expect(canTransitionGuarantee("in_process", "approved")).toBe(true);
    expect(canTransitionGuarantee("in_process", "active")).toBe(false);
    expect(canTransitionGuarantee("approved", "active")).toBe(true);
    expect(canTransitionGuarantee("active", "released")).toBe(true);
    expect(canTransitionGuarantee("released", "active")).toBe(false);
    expect(canTransitionGuarantee("rejected", "in_process")).toBe(true);
  });

  it("avisos: vencimiento, trámite demorado y requisitos", () => {
    const base = {
      status: "active" as const,
      validUntil: "2026-12-01",
      requestedAt: "2026-01-01",
      requirements: [],
    };
    expect(guaranteeAlerts(base, "2026-06-01")).toEqual([]);
    expect(guaranteeAlerts(base, "2026-11-01")).toEqual(["expiring"]);
    expect(guaranteeAlerts(base, "2026-12-02")).toEqual(["expired"]);
    expect(
      guaranteeAlerts(
        { ...base, status: "in_process", requirements: [{ label: "CI", done: false }] },
        "2026-01-20",
      ),
    ).toEqual(["stale", "missing_requirements"]);
  });

  it("valida montos y fechas", () => {
    const ok = createGuaranteeSchema.safeParse({
      tenantContactId: "01890a5d-ac96-774b-bcce-b302099a8057",
      type: "insurance",
      coverage: "600.000",
      validFrom: "2026-01-01",
      validUntil: "2027-01-01",
    });
    expect(ok.success && ok.data.coverageMinor).toBe(60_000_000n);
    const bad = createGuaranteeSchema.safeParse({
      tenantContactId: "01890a5d-ac96-774b-bcce-b302099a8057",
      type: "anda",
      validFrom: "2027-01-01",
      validUntil: "2026-01-01",
    });
    expect(bad.success).toBe(false);
  });
});
