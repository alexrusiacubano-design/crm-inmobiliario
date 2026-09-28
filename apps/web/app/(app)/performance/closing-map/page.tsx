import { closingMap } from "@crm/core";
import { getDb } from "@crm/db";
import { PROPERTY_OPERATION_LABELS, PROPERTY_OPERATIONS } from "@crm/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { ClosingMap } from "@/components/performance/closing-map";
import { price } from "@/components/properties/format";
import { Card, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requirePagePermission } from "@/lib/session";
import { DEFAULT_TZ, ymdInTz } from "@/lib/tz";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Mapa de cierre" };

const RANGES = [
  { k: "all", l: "Histórico" },
  { k: "year", l: "Este año" },
  { k: "12m", l: "Últimos 12 meses" },
] as const;

const KIND_LABEL = { sold: "Vendida", rented: "Alquilada", reserved: "Reservada" } as const;

export default async function ClosingMapPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { ctx } = await requirePagePermission("property.read");
  const params = await searchParams;
  const today = ymdInTz(new Date(), ctx.organization.timezone || DEFAULT_TZ);
  const r = await closingMap(getDb(), ctx, { range: params.range, operation: params.operation, today });
  const total = r.counts.sold + r.counts.rented + r.counts.reserved;
  const href = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...params, ...patch })) if (v) next.set(k, v);
    return `?${next.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Mapa de cierre"
        description={`${r.points.length} cierres en el mapa · ${total} en total${
          r.withoutLocation
            ? ` · ${r.withoutLocation} sin coordenadas (se cargan en la ficha de la propiedad)`
            : ""
        }`}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <nav aria-label="Período" className="flex rounded-md border p-0.5 text-sm">
          {RANGES.map((x) => (
            <Link
              key={x.k}
              href={href({ range: x.k === "all" ? undefined : x.k })}
              className={cn(
                "rounded px-3 py-1",
                (params.range ?? "all") === x.k
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground",
              )}
            >
              {x.l}
            </Link>
          ))}
        </nav>
        <nav aria-label="Operación" className="flex rounded-md border p-0.5 text-sm">
          {[undefined, ...PROPERTY_OPERATIONS].map((o) => (
            <Link
              key={o ?? "all"}
              href={href({ operation: o })}
              className={cn(
                "rounded px-3 py-1",
                params.operation === o ? "bg-primary text-primary-foreground" : "text-muted-foreground",
              )}
            >
              {o ? PROPERTY_OPERATION_LABELS[o] : "Todos los tipos"}
            </Link>
          ))}
        </nav>
      </div>

      <ClosingMap
        counts={r.counts}
        mine={r.mine}
        points={r.points.map((p) => ({
          id: p.id,
          kind: p.kind,
          propertyId: p.propertyId,
          label: p.label,
          lat: p.lat ?? 0,
          lng: p.lng ?? 0,
          date: p.date,
          priceText: price(p.priceMinor, p.currency),
        }))}
      />

      {r.points.length > 0 && (
        <Card className="mt-5">
          <h2 className="border-b px-4 py-3 text-sm font-semibold">Detalle</h2>
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Propiedad</TH>
                <TH>Estado</TH>
                <TH className="text-right">Precio</TH>
                <TH className="hidden sm:table-cell text-right">Fecha</TH>
              </TR>
            </THead>
            <TBody>
              {r.points.slice(0, 50).map((p) => (
                <TR key={p.id}>
                  <TD>
                    <Link href={`/properties/${p.propertyId}`} className="hover:underline">
                      {p.label}
                    </Link>
                  </TD>
                  <TD>{KIND_LABEL[p.kind]}</TD>
                  <TD className="text-right tabular">{price(p.priceMinor, p.currency)}</TD>
                  <TD className="hidden text-right text-muted-foreground tabular sm:table-cell">
                    {p.date.split("-").reverse().join("/")}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </>
  );
}
