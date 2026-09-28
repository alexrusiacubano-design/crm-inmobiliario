import { listValuations } from "@crm/core";
import { getDb } from "@crm/db";
import { PROPERTY_TYPE_LABELS, VALUATION_METHOD_LABELS, type PropertyType } from "@crm/shared";
import { Scale } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Pagination } from "@/components/data/list-controls";
import { formatDay, price } from "@/components/properties/format";
import { Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requirePagePermission } from "@/lib/session";

export const metadata: Metadata = { title: "Tasaciones" };

export default async function ValuationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { ctx } = await requirePagePermission("valuation.read");
  const params = await searchParams;
  const list = await listValuations(getDb(), ctx, params);
  return (
    <>
      <PageHeader
        title="Tasaciones"
        description="Registro histórico de tasaciones con método, rango y comparables. Se cargan desde la propiedad o la captación y no se editan."
      />
      <Card>
        {list.items.length === 0 ? (
          <EmptyState
            icon={Scale}
            title="Todavía no hay tasaciones"
            description="Cargalas desde una captación o una propiedad."
          />
        ) : (
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Fecha</TH>
                <TH>Inmueble</TH>
                <TH className="text-right">Valor</TH>
                <TH className="hidden text-right md:table-cell">Rango</TH>
                <TH className="hidden sm:table-cell">Método</TH>
                <TH className="hidden lg:table-cell">Tasador</TH>
              </TR>
            </THead>
            <TBody>
              {list.items.map((v) => (
                <TR key={v.id}>
                  <TD className="whitespace-nowrap">{formatDay(v.valuedAt)}</TD>
                  <TD>
                    {v.propertyId && v.propertyCode ? (
                      <Link href={`/properties/${v.propertyId}?tab=valuations`} className="hover:underline">
                        <span className="font-mono">{v.propertyCode}</span>
                        {v.propertyTitle ? ` · ${v.propertyTitle}` : ""}
                      </Link>
                    ) : v.acquisitionId && v.acquisitionCode ? (
                      <Link
                        href={`/properties/acquisitions/${v.acquisitionId}`}
                        className="font-mono hover:underline"
                      >
                        {v.acquisitionCode}
                      </Link>
                    ) : (
                      "—"
                    )}
                    {v.propertyType && (
                      <p className="text-xs text-muted-foreground">
                        {PROPERTY_TYPE_LABELS[v.propertyType as PropertyType]}
                      </p>
                    )}
                  </TD>
                  <TD className="text-right font-medium tabular">{price(v.valueMinor, v.currency)}</TD>
                  <TD className="hidden text-right text-muted-foreground tabular md:table-cell">
                    {v.minMinor !== null || v.maxMinor !== null
                      ? `${price(v.minMinor, v.currency)} – ${price(v.maxMinor, v.currency)}`
                      : "—"}
                  </TD>
                  <TD className="hidden sm:table-cell">{VALUATION_METHOD_LABELS[v.method]}</TD>
                  <TD className="hidden text-muted-foreground lg:table-cell">{v.valuedBy ?? "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        <Pagination page={list.page} pageSize={list.pageSize} total={list.total} />
      </Card>
    </>
  );
}
