import { listInvoices, pendingToInvoice } from "@crm/core";
import { getDb } from "@crm/db";
import {
  INVOICE_KIND_LABELS,
  INVOICE_STATUS_LABELS,
  RECEIVER_DOC_TYPE_LABELS,
  type InvoiceStatus,
} from "@crm/shared/invoicing";
import { Printer, Receipt } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { InvoiceDialog, IssueDialog, VoidInvoiceButton } from "@/components/finance/invoice-controls";
import { formatDay, price } from "@/components/properties/format";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requirePagePermission } from "@/lib/session";
import { DEFAULT_TZ, ymdInTz } from "@/lib/tz";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Facturación" };

const TABS = [
  { key: "pending", label: "Por facturar" },
  { key: "draft", label: "Borradores" },
  { key: "issued", label: "Emitidas" },
  { key: "voided", label: "Anuladas" },
] as const;
const TONE: Record<InvoiceStatus, "neutral" | "success" | "danger"> = {
  draft: "neutral",
  issued: "success",
  voided: "danger",
};

export default async function InvoicingPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { ctx } = await requirePagePermission("invoice.read");
  const db = getDb();
  const { tab: raw } = await searchParams;
  const today = ymdInTz(new Date(), ctx.organization.timezone || DEFAULT_TZ);
  const all = await listInvoices(db, ctx, { status: "all" });
  const canManage = all.canManage;
  const tab = TABS.some((t) => t.key === raw)
    ? (raw as (typeof TABS)[number]["key"])
    : canManage
      ? "pending"
      : "issued";
  const pending = canManage && tab === "pending" ? await pendingToInvoice(db, ctx) : [];
  const rows = all.items.filter((i) => i.status === tab);
  const count = (k: string) => (k === "pending" ? null : all.items.filter((i) => i.status === k).length);

  return (
    <>
      <PageHeader
        title="Facturación"
        description="Honorarios y comisiones de administración para facturar. Armás el borrador acá, emitís el CFE en DGI o tu proveedor y cargás la serie y el número."
        actions={
          canManage ? (
            <InvoiceDialog
              label="Nueva factura"
              initial={{
                contactId: null,
                receiverName: "",
                receiverDocType: "ci",
                receiverDoc: "",
                receiverAddress: "",
                currency: "UYU",
                lines: [{ description: "", amount: "", sourceType: null, sourceId: null }],
              }}
            />
          ) : null
        }
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Facturado (emitidas)</p>
          <p className="mt-1 text-xl font-semibold tabular">
            {[
              all.issuedTotals.USD ? price(all.issuedTotals.USD, "USD") : null,
              all.issuedTotals.UYU ? price(all.issuedTotals.UYU, "UYU") : null,
            ]
              .filter(Boolean)
              .join(" + ") || "—"}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Borradores sin emitir</p>
          <p className="mt-1 text-xl font-semibold tabular">{count("draft")}</p>
        </Card>
        <Card className="p-4 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Emisión del CFE</p>
          <p className="mt-1">
            Hasta conectar un proveedor habilitado por DGI, el CFE se emite en el portal de DGI (Facturación
            gratuita) o en tu sistema actual. El CRM lleva el registro, evita facturar dos veces y arma el
            comprobante para el cliente.
          </p>
        </Card>
      </div>
      <nav aria-label="Facturación" className="mb-4 flex gap-1 overflow-x-auto border-b">
        {TABS.filter((t) => canManage || t.key !== "pending").map((t) => (
          <Link
            key={t.key}
            href={`?tab=${t.key}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={cn(
              "shrink-0 border-b-2 px-3 py-2 text-sm",
              tab === t.key
                ? "border-primary font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {count(t.key) ? <span className="ml-1 text-xs text-muted-foreground">{count(t.key)}</span> : null}
          </Link>
        ))}
      </nav>
      {tab === "pending" ? (
        <Card>
          {pending.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="Nada pendiente de facturar"
              description="Aparecen los honorarios de operaciones firmadas o cobradas y las comisiones de administración de las liquidaciones aprobadas."
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Concepto</TH>
                  <TH>A facturar a</TH>
                  <TH className="text-right">Monto (sin IVA)</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {pending.map((p) => (
                  <TR key={p.sourceId}>
                    <TD>
                      <p className="text-sm">{p.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.collected ? "Cobrado" : "Pendiente de cobro"}
                        {p.date ? ` · ${formatDay(p.date)}` : ""}
                      </p>
                    </TD>
                    <TD className="text-sm">{p.receiver.name || "—"}</TD>
                    <TD className="text-right tabular">{price(p.amountMinor, p.currency)}</TD>
                    <TD className="text-right">
                      <InvoiceDialog
                        label="Facturar"
                        variant="secondary"
                        initial={{
                          contactId: p.receiver.contactId,
                          receiverName: p.receiver.name,
                          receiverDocType: p.receiver.docType,
                          receiverDoc: p.receiver.doc ?? "",
                          receiverAddress: p.receiver.address ?? "",
                          currency: p.currency,
                          lines: [
                            {
                              description: p.description,
                              amount: (Number(p.amountMinor) / 100).toFixed(2).replace(".", ","),
                              sourceType: p.sourceType,
                              sourceId: p.sourceId,
                            },
                          ],
                        }}
                      />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      ) : (
        <Card>
          {rows.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">No hay facturas en esta vista.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Factura</TH>
                  <TH>Receptor</TH>
                  <TH>CFE</TH>
                  <TH className="text-right">Total</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {rows.map((i) => (
                  <TR key={i.id}>
                    <TD>
                      <span className="font-mono text-xs">{i.code}</span>
                      <span className="ml-2">
                        <Badge tone={TONE[i.status]}>{INVOICE_STATUS_LABELS[i.status]}</Badge>
                      </span>
                      {i.voidReason && <p className="text-xs text-muted-foreground">{i.voidReason}</p>}
                    </TD>
                    <TD className="text-sm">
                      {i.receiverName}
                      <p className="text-xs text-muted-foreground">
                        {RECEIVER_DOC_TYPE_LABELS[i.receiverDocType]} {i.receiverDoc ?? ""}
                      </p>
                    </TD>
                    <TD className="text-sm">
                      {INVOICE_KIND_LABELS[i.kind]}
                      {i.cfeNumber ? ` ${i.cfeSeries}-${i.cfeNumber}` : ""}
                      {i.issuedAt && <p className="text-xs text-muted-foreground">{formatDay(i.issuedAt)}</p>}
                    </TD>
                    <TD className="text-right tabular">{price(i.totalMinor, i.currency)}</TD>
                    <TD>
                      <div className="flex flex-wrap justify-end gap-1">
                        <a
                          href={`/print/factura/${i.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                        >
                          <Printer className="size-3.5" /> {i.status === "draft" ? "Proforma" : "Comprobante"}
                        </a>
                        {canManage && i.status === "draft" && (
                          <IssueDialog id={i.id} code={i.code} today={today} />
                        )}
                        {canManage && i.status !== "voided" && (
                          <VoidInvoiceButton id={i.id} draft={i.status === "draft"} />
                        )}
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      )}
    </>
  );
}
