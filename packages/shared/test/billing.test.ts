import { describe, expect, it } from "vitest";
import {
  addPeriod,
  chargeStatus,
  computeSettlement,
  dueDateFor,
  periodEnd,
  periodLabel,
} from "../src/billing";

describe("cobros", () => {
  it("estado de la cuota", () => {
    expect(chargeStatus(1000n, 0n, "2026-10-10", "2026-10-05")).toBe("pending");
    expect(chargeStatus(1000n, 400n, "2026-10-10", "2026-10-05")).toBe("partial");
    expect(chargeStatus(1000n, 400n, "2026-10-10", "2026-10-11")).toBe("overdue");
    expect(chargeStatus(1000n, 1000n, "2026-10-10", "2026-12-01")).toBe("paid");
  });
  it("períodos", () => {
    expect(dueDateFor("2026-02-01", 10)).toBe("2026-02-10");
    expect(periodEnd("2028-02-01")).toBe("2028-02-29");
    expect(addPeriod("2026-12-01", 1)).toBe("2027-01-01");
    expect(periodLabel("2026-10-01")).toBe("octubre 2026");
  });
});

describe("liquidación", () => {
  it("comisión solo sobre el alquiler y reparto exacto entre propietarios", () => {
    const r = computeSettlement({
      currency: "UYU",
      collectedMinor: 3_000_000n, // 25.000 alquiler + 5.000 gastos comunes
      rentPortionMinor: 2_500_000n,
      adminFeeBasisPoints: 600,
      deductionsMinor: 100_001n,
      owners: [
        { contactId: "a", shareBasisPoints: 3333 },
        { contactId: "b", shareBasisPoints: 6667 },
      ],
    });
    expect(r.feeMinor).toBe(150_000n); // 6 % de 25.000
    expect(r.netMinor).toBe(2_749_999n);
    expect(r.shares.reduce((a, s) => a + s.amountMinor, 0n)).toBe(r.netMinor);
  });
  it("pago parcial: la comisión se calcula sobre lo cobrado", () => {
    const r = computeSettlement({
      currency: "UYU",
      collectedMinor: 1_000_000n,
      rentPortionMinor: 2_500_000n,
      adminFeeBasisPoints: 1000,
      deductionsMinor: 0n,
      owners: [{ contactId: "a", shareBasisPoints: 10_000 }],
    });
    expect(r.feeMinor).toBe(100_000n);
    expect(r.shares[0]?.amountMinor).toBe(900_000n);
  });
});
