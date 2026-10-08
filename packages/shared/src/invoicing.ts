/**
 * Facturación de honorarios: cálculo de IVA (básico 22 %), tipo de comprobante según el
 * receptor (e-Factura con RUT, e-Ticket a consumidor final) y estados.
 */

export const IVA_BASIC_BP = 2200;

export const INVOICE_STATUSES = ["draft", "issued", "voided"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Borrador",
  issued: "Emitida",
  voided: "Anulada",
};

export const INVOICE_KINDS = ["e_factura", "e_ticket"] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];
export const INVOICE_KIND_LABELS: Record<InvoiceKind, string> = {
  e_factura: "e-Factura",
  e_ticket: "e-Ticket",
};

export const RECEIVER_DOC_TYPES = ["rut", "ci", "other"] as const;
export type ReceiverDocType = (typeof RECEIVER_DOC_TYPES)[number];
export const RECEIVER_DOC_TYPE_LABELS: Record<ReceiverDocType, string> = {
  rut: "RUT",
  ci: "Cédula",
  other: "Otro documento",
};

/** Con RUT corresponde e-Factura; a consumidor final, e-Ticket. */
export function invoiceKindFor(docType: ReceiverDocType): InvoiceKind {
  return docType === "rut" ? "e_factura" : "e_ticket";
}

/** Redondeo al entero más cercano (mitad hacia arriba) de a*b/c con bigint. */
function mulDivRound(a: bigint, b: bigint, c: bigint): bigint {
  const n = a * b;
  return n >= 0n ? (n * 2n + c) / (2n * c) : -((-n * 2n + c) / (2n * c));
}

/**
 * Separa neto e IVA de un importe. Si `taxIncluded`, el importe ya trae el IVA; si no, se
 * suma encima. El total siempre es neto + IVA exacto.
 */
export function splitTax(
  amountMinor: bigint,
  taxIncluded: boolean,
  rateBp = IVA_BASIC_BP,
): { netMinor: bigint; taxMinor: bigint; totalMinor: bigint } {
  if (taxIncluded) {
    const net = mulDivRound(amountMinor, 10_000n, BigInt(10_000 + rateBp));
    return { netMinor: net, taxMinor: amountMinor - net, totalMinor: amountMinor };
  }
  const tax = mulDivRound(amountMinor, BigInt(rateBp), 10_000n);
  return { netMinor: amountMinor, taxMinor: tax, totalMinor: amountMinor + tax };
}

/** Dígito verificador del RUT uruguayo (12 dígitos, módulo 11). */
export function isValidRut(rut: string): boolean {
  const d = rut.replace(/\D/g, "");
  if (d.length !== 12) return false;
  const weights = [4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((s, w, i) => s + w * Number(d[i]), 0);
  const mod = 11 - (sum % 11);
  const check = mod === 11 ? 0 : mod === 10 ? null : mod;
  return check !== null && check === Number(d[11]);
}

export const INVOICE_SOURCE_TYPES = ["deal_commission", "settlement_fee"] as const;
export type InvoiceSourceType = (typeof INVOICE_SOURCE_TYPES)[number];
