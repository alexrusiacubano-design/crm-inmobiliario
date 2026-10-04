import { describe, expect, it } from "vitest";
import { funnelCounts, furthestStage, lastMonths, median, monthLabel, pct, toCsv } from "../src/reports";

describe("reportes", () => {
  it("embudo acumulado por etapa más avanzada", () => {
    expect(furthestStage("lost", ["contacted", "visit"])).toBe("visit");
    expect(furthestStage("qualified", [])).toBe("qualified");
    expect(furthestStage("lost", [])).toBe("new");
    const f = funnelCounts(["new", "contacted", "visit", "won"]);
    expect(f.map((x) => x.count)).toEqual([4, 3, 2, 2, 1, 1, 1]);
  });
  it("mediana, porcentaje y meses", () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(pct(1, 3)).toBe(33);
    expect(pct(1, 0)).toBeNull();
    expect(lastMonths("2026-02-15", 3)).toEqual(["2025-12", "2026-01", "2026-02"]);
    expect(monthLabel("2026-10")).toBe("oct 26");
  });
  it("CSV con ; comillas y sin fórmulas", () => {
    const csv = toCsv(
      ["a", "b"],
      [
        ["x;y", 3],
        ['di "hola"', null],
        ["=SUM(A1)", -2],
      ],
    );
    expect(csv).toBe('﻿a;b\r\n"x;y";3\r\n"di ""hola""";\r\n\'=SUM(A1);-2\r\n');
  });
});
