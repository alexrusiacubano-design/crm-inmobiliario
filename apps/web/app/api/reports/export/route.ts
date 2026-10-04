import { commercialReport, inventoryReport, isAppError, operationsReport } from "@crm/core";
import { getDb } from "@crm/db";
import { LEAD_SOURCE_LABELS, type LeadSource } from "@crm/shared";
import { toCsv } from "@crm/shared/reports";
import { getSessionContext } from "@/lib/session";
import { DEFAULT_TZ, ymdInTz } from "@/lib/tz";

/** Exporta una tabla de reportes a CSV (con la sesión y el alcance de quien la pide). */
export async function GET(request: Request) {
  const session = await getSessionContext();
  if (!session) return new Response("No autorizado", { status: 401 });
  const { ctx } = session;
  const u = new URL(request.url).searchParams;
  const query = {
    period: u.get("period") ?? "month",
    from: u.get("from"),
    to: u.get("to"),
    today: ymdInTz(new Date(), ctx.organization.timezone || DEFAULT_TZ),
    branchId: u.get("branch"),
    userId: u.get("user"),
  };
  const db = getDb();
  const table = u.get("table");
  let csv: string;
  try {
    if (table === "sources" || table === "agents") {
      const r = await commercialReport(db, ctx, query);
      const header = ["Leads", "Contactados", "Ganados", "Perdidos", "Conversión %", "1.ª respuesta (h)"];
      csv =
        table === "sources"
          ? toCsv(
              ["Origen", ...header],
              r.bySource.map((s) => [
                LEAD_SOURCE_LABELS[s.source as LeadSource] ?? s.source,
                s.leads,
                s.contacted,
                s.won,
                s.lost,
                s.conversion,
                s.responseHours?.toFixed(1).replace(".", ",") ?? null,
              ]),
            )
          : toCsv(
              ["Agente", ...header],
              r.byAgent.map((s) => [
                s.name,
                s.leads,
                s.contacted,
                s.won,
                s.lost,
                s.conversion,
                s.responseHours?.toFixed(1).replace(".", ",") ?? null,
              ]),
            );
    } else if (table === "deal-agents" || table === "deals") {
      const r = await operationsReport(db, ctx, query);
      csv =
        table === "deals"
          ? toCsv(
              ["Operación", "Propiedad", "Tipo", "Agente", "Cierre", "Moneda", "Precio"],
              r.deals.map((d) => [
                d.code,
                d.propertyCode,
                d.operation,
                d.agent,
                d.closedAt,
                d.currency,
                (Number(d.priceMinor) / 100).toFixed(2).replace(".", ","),
              ]),
            )
          : toCsv(
              ["Agente", "Cierres", "Ventas", "Alquileres", "Volumen USD", "Honorarios USD"],
              r.byAgent.map((a) => [a.name, a.deals, a.sales, a.rentals, a.volumeUsd, a.feesUsd]),
            );
    } else if (table === "stale") {
      const r = await inventoryReport(db, ctx, query);
      csv = toCsv(
        ["Código", "Propiedad", "Responsable", "En el mercado desde", "Días"],
        r.stale.map((s) => [s.code, s.title, s.agent, s.since, s.days]),
      );
    } else return new Response("Tabla desconocida", { status: 400 });
  } catch (error) {
    if (isAppError(error)) return new Response(error.message, { status: 403 });
    throw error;
  }
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="reporte-${table}-${query.today}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
