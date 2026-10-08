import { getInvoice, getOrganization, NotFoundError, ValidationError } from "@crm/core";
import { getDb } from "@crm/db";
import { INVOICE_KIND_LABELS, RECEIVER_DOC_TYPE_LABELS } from "@crm/shared/invoicing";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatDay, price } from "@/components/properties/format";
import { PrintSheet, Row } from "@/components/print/sheet";
import { requirePagePermission } from "@/lib/session";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Factura" };

export default async function PrintInvoice({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requirePagePermission("invoice.read");
  const { id } = await params;
  const db = getDb();
  const [org, data] = await Promise.all([
    getOrganization(db, ctx),
    getInvoice(db, ctx, id).catch((e: unknown) => {
      if (e instanceof NotFoundError || e instanceof ValidationError) notFound();
      throw e;
    }),
  ]);
  const i = data.invoice;
  const title =
    i.status === "draft"
      ? "Proforma"
      : i.status === "voided"
        ? "Comprobante anulado"
        : INVOICE_KIND_LABELS[i.kind];
  return (
    <PrintSheet
      org={org}
      title={title}
      number={i.cfeNumber ? `Serie ${i.cfeSeries} N.º ${i.cfeNumber}` : i.code}
      date={i.issuedAt ? formatDay(i.issuedAt) : formatDateTime(new Date())}
      back={{ href: "/finance/invoicing", label: "Facturación" }}
      footer={`Documento generado por ${org.name}.`}
    >
      <section className="mb-6 text-[12px]">
        <p className="text-neutral-500">Receptor</p>
        <p className="text-sm font-medium">{i.receiverName}</p>
        <p>
          {RECEIVER_DOC_TYPE_LABELS[i.receiverDocType]} {i.receiverDoc ?? "—"}
          {i.receiverAddress ? ` · ${i.receiverAddress}` : ""}
        </p>
      </section>
      <table className="mb-6 w-full text-[12px]">
        <thead>
          <tr className="border-b border-neutral-300 text-left text-neutral-500">
            <th className="py-1 font-normal">Concepto</th>
            <th className="py-1 text-right font-normal">Neto</th>
            <th className="py-1 text-right font-normal">IVA</th>
          </tr>
        </thead>
        <tbody>
          {data.lines.map((l) => (
            <tr key={l.id} className="border-b border-neutral-200">
              <td className="py-1">{l.description}</td>
              <td className="py-1 text-right tabular-nums">{price(l.netMinor, i.currency)}</td>
              <td className="py-1 text-right tabular-nums">
                {price(l.taxMinor, i.currency)} ({l.taxRateBp / 100} %)
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <section className="ml-auto max-w-[80mm]">
        <Row label="Subtotal" value={price(i.subtotalMinor, i.currency)} />
        <Row label="IVA tasa básica" value={price(i.taxMinor, i.currency)} />
        <Row label="Total" value={price(i.totalMinor, i.currency)} strong />
      </section>
      {i.notes && <p className="mt-6 text-[12px]">{i.notes}</p>}
      <p className="mt-8 text-[11px] text-neutral-500">
        Referencia interna {i.code}.
        {i.status === "issued"
          ? " El comprobante fiscal válido es el CFE emitido en DGI con la serie y el número indicados."
          : i.status === "draft"
            ? " Documento sin valor fiscal: el CFE se emite por separado."
            : ` Anulado: ${i.voidReason ?? ""}`}
      </p>
    </PrintSheet>
  );
}
