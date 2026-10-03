import { describe, expect, it } from "vitest";
import {
  canTransitionPublication,
  normalizeRate,
  parseBcuResponse,
  publicationAlerts,
  quotaLeft,
} from "../src/publications";

describe("publicaciones", () => {
  it("transiciones y avisos", () => {
    expect(canTransitionPublication("published", "paused")).toBe(true);
    expect(canTransitionPublication("removed", "paused")).toBe(false);
    const p = {
      status: "published" as const,
      expiresAt: "2026-10-08",
      url: null,
      portal: "infocasas" as const,
    };
    expect(publicationAlerts(p, "available", "2026-10-03")).toEqual(["expiring", "no_url"]);
    expect(publicationAlerts({ ...p, url: "https://x.uy/a" }, "sold", "2026-10-10")).toEqual([
      "property_unavailable",
      "expired",
    ]);
    expect(publicationAlerts({ ...p, status: "paused" }, "sold", "2026-10-10")).toEqual([]);
  });
  it("cupos por nivel", () => {
    expect(quotaLeft({ gold: 3 }, { gold: 2 }, "gold")).toBe(1);
    expect(quotaLeft({}, { gold: 9 }, "gold")).toBeNull();
  });
});

describe("tipo de cambio", () => {
  it("normaliza", () => {
    expect(normalizeRate("40,25")).toBe("40.2500");
    expect(normalizeRate("0")).toBeNull();
    expect(normalizeRate("abc")).toBeNull();
  });
  it("lee la respuesta del BCU y se queda con la última fecha", () => {
    const xml = `<SOAP-ENV:Envelope><SOAP-ENV:Body><wsbcucotizaciones.ExecuteResponse><Salida>
      <respuestastatus><status>1</status></respuestastatus>
      <datoscotizaciones>
        <datoscotizaciones.dato><Fecha>2026-10-01</Fecha><Moneda>2225</Moneda><TCC>39.80</TCC><TCV>39.90</TCV></datoscotizaciones.dato>
        <datoscotizaciones.dato><Fecha>2026-10-02</Fecha><Moneda>2225</Moneda><TCC>39.95</TCC><TCV>40.05</TCV></datoscotizaciones.dato>
      </datoscotizaciones></Salida></wsbcucotizaciones.ExecuteResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
    expect(parseBcuResponse(xml)).toEqual({ date: "2026-10-02", rate: "40.05" });
    expect(parseBcuResponse("<x/>")).toBeNull();
  });
});
