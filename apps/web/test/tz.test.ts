import { describe, expect, it } from "vitest";
import { whatsappLink } from "../lib/utils";
import { addDays, hmInTz, tzOffsetMinutes, weekdayMon0, ymdInTz, zonedToDate } from "../lib/tz";

const TZ = "America/Montevideo";

describe("zona horaria de la agenda", () => {
  it("Montevideo está en UTC-3", () => {
    expect(tzOffsetMinutes(new Date("2026-09-28T12:00:00Z"), TZ)).toBe(-180);
  });

  it("convierte fecha y hora local a instante y vuelta", () => {
    const d = zonedToDate("2026-09-28", "17:30", TZ);
    expect(d.toISOString()).toBe("2026-09-28T20:30:00.000Z");
    expect(ymdInTz(d, TZ)).toBe("2026-09-28");
    expect(hmInTz(d, TZ)).toBe("17:30");
  });

  it("un evento a las 22:00 locales es del mismo día aunque en UTC sea el siguiente", () => {
    const d = zonedToDate("2026-09-28", "22:00", TZ);
    expect(d.toISOString().slice(0, 10)).toBe("2026-09-29");
    expect(ymdInTz(d, TZ)).toBe("2026-09-28");
  });

  it("aritmética de días y semana que empieza el lunes", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(weekdayMon0("2026-09-28")).toBe(0);
    expect(weekdayMon0("2026-10-04")).toBe(6);
  });
});

describe("enlace de WhatsApp", () => {
  it("normaliza celulares uruguayos y rechaza números cortos", () => {
    expect(whatsappLink("099 123 456")).toBe("https://wa.me/59899123456");
    expect(whatsappLink("+598 99 123 456")).toBe("https://wa.me/59899123456");
    expect(whatsappLink("2 600 1234")).toBeNull();
    expect(whatsappLink(null)).toBeNull();
  });
});
