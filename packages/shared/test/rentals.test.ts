import { describe, expect, it } from "vitest";
import {
  addMonths,
  adjustRent,
  changeBasisPoints,
  contractAlerts,
  contractEnd,
  firstAdjustment,
  nextAdjustmentAfter,
} from "../src/rentals";
import { applyAdjustmentSchema, createContractSchema } from "../src/validation/rentals";

describe("fechas de contrato", () => {
  it("suma meses respetando fin de mes y calcula el fin del plazo", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
    expect(contractEnd("2026-03-01", 24)).toBe("2028-02-29");
    expect(contractEnd("2026-01-15", 12)).toBe("2027-01-14");
  });

  it("programa ajustes dentro del plazo", () => {
    expect(firstAdjustment("2026-03-01", "2028-02-29", "ipc", 12)).toBe("2027-03-01");
    expect(firstAdjustment("2026-03-01", "2027-02-28", "ipc", 12)).toBeNull();
    expect(firstAdjustment("2026-03-01", "2028-02-29", "none", 12)).toBeNull();
    expect(nextAdjustmentAfter("2027-03-01", "2028-02-29", 12)).toBeNull();
    expect(nextAdjustmentAfter("2027-03-01", "2028-02-29", 6)).toBe("2027-09-01");
  });
});

describe("montos", () => {
  it("ajusta por porcentaje y redondea a pesos enteros", () => {
    expect(adjustRent(2_500_000n, 550)).toBe(2_637_500n); // 25.000 + 5,5 % = 26.375
    expect(adjustRent(2_345_600n, 333)).toBe(2_423_700n); // 23.456 × 1,0333 = 24.237,0 → 24.237
    expect(adjustRent(2_000_000n, -1000)).toBe(1_800_000n);
    expect(changeBasisPoints(2_500_000n, 2_637_500n)).toBe(550);
  });
});

describe("avisos", () => {
  const base = {
    status: "active" as const,
    startDate: "2026-01-01",
    endDate: "2027-12-31",
    nextAdjustmentAt: "2027-01-01",
  };
  it("marca vencimientos y ajustes", () => {
    expect(contractAlerts(base, "2026-06-01")).toEqual([]);
    expect(contractAlerts(base, "2026-12-15")).toEqual(["adjustment_due"]);
    expect(contractAlerts(base, "2027-01-05")).toEqual(["adjustment_overdue"]);
    expect(contractAlerts({ ...base, nextAdjustmentAt: null }, "2027-11-01")).toEqual(["expiring"]);
    expect(contractAlerts({ ...base, nextAdjustmentAt: null }, "2028-01-02")).toEqual(["expired"]);
    expect(contractAlerts({ ...base, status: "ended" }, "2028-01-02")).toEqual([]);
  });
});

describe("validación", () => {
  it("contrato: exige alquiler y porcentaje si el ajuste es fijo", () => {
    const ok = createContractSchema.safeParse({
      propertyId: "01890a5d-ac96-774b-bcce-b302099a8057",
      tenantContactId: "01890a5d-ac96-774b-bcce-b302099a8058",
      startDate: "2026-03-01",
      months: 24,
      rent: "25.000",
      deposit: "50000",
      adminFeePercent: "6",
    });
    expect(ok.success && ok.data.rentMinor).toBe(2_500_000n);
    expect(ok.success && ok.data.adminFeeBasisPoints).toBe(600);
    const bad = createContractSchema.safeParse({
      propertyId: "01890a5d-ac96-774b-bcce-b302099a8057",
      tenantContactId: "01890a5d-ac96-774b-bcce-b302099a8058",
      startDate: "2026-03-01",
      months: 24,
      rent: "",
      adjustmentIndex: "fixed",
    });
    expect(bad.success).toBe(false);
  });
  it("ajuste: acepta porcentaje negativo o monto", () => {
    const r = applyAdjustmentSchema.safeParse({
      contractId: "01890a5d-ac96-774b-bcce-b302099a8057",
      effectiveFrom: "2027-03-01",
      percent: "-2,5",
    });
    expect(r.success && r.data.basisPoints).toBe(-250);
    expect(
      applyAdjustmentSchema.safeParse({
        contractId: "01890a5d-ac96-774b-bcce-b302099a8057",
        effectiveFrom: "2027-03-01",
      }).success,
    ).toBe(false);
  });
});
