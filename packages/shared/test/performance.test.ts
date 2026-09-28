import { describe, expect, it } from "vitest";
import { periodRange, periodTarget } from "../src/performance";

describe("períodos del parte", () => {
  it("semana desde el lunes, mes, trimestre, año y personalizado inclusivo", () => {
    expect(periodRange("week", "2026-09-30")).toMatchObject({ from: "2026-09-28", to: "2026-10-05" });
    expect(periodRange("month", "2026-12-15")).toMatchObject({
      from: "2026-12-01",
      to: "2027-01-01",
      months: 1,
    });
    expect(periodRange("quarter", "2026-08-10")).toMatchObject({
      from: "2026-07-01",
      to: "2026-10-01",
      months: 3,
    });
    expect(periodRange("year", "2026-08-10")).toMatchObject({ from: "2026-01-01", to: "2027-01-01" });
    expect(periodRange("custom", "2026-08-10", { from: "2026-08-01", to: "2026-08-31" })).toMatchObject({
      from: "2026-08-01",
      to: "2026-09-01",
    });
    expect(periodTarget(4, 7 / 30)).toBe(1);
    expect(periodTarget(4, 3)).toBe(12);
  });
});
