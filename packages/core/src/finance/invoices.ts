import { and, desc, eq, inArray, isNull, notExists, sql } from "drizzle-orm";
import {
  contact,
  deal,
  dealCommission,
  invoice,
  invoiceLine,
  ownerSettlement,
  property,
  propertyOwner,
  rentCharge,
  rentalContract,
  user,
  type Db,
  type DbOrTx,
} from "@crm/db";
import { COMMISSION_SIDE_LABELS, type CommissionSide } from "@crm/shared/deals";
import {
  IVA_BASIC_BP,
  invoiceKindFor,
  splitTax,
  type InvoiceSourceType,
  type InvoiceStatus,
  type ReceiverDocType,
} from "@crm/shared/invoicing";
import type { Currency } from "@crm/shared/money";
import { uuidSchema } from "@crm/shared/validation";
import { createInvoiceSchema, issueInvoiceSchema, voidInvoiceSchema } from "@crm/shared/validation/invoicing";
import { writeAudit } from "../audit";
import { hasPermission, requirePermission, type RequestContext } from "../context";
import { ConflictError, NotFoundError, ValidationError, parseInput } from "../errors";
import { nextCode } from "../sequences";

const toMinor = (v: string) => {
  const [i = "0", d = ""] = v.replace(",", ".").split(".");
  return BigInt(i) * 100n + BigInt((d + "00").slice(0, 2));
};

export interface ReceiverSuggestion {
  contactId: string | null;
  name: string;
  docType: ReceiverDocType;
  doc: string | null;
  address: string | null;
}

async function receiverFor(
  db: DbOrTx,
  ctx: RequestContext,
  contactId: string | null,
): Promise<ReceiverSuggestion> {
  if (!contactId) return { contactId: null, name: "", docType: "ci", doc: null, address: null };
  const [c] = await db.select().from(contact).where(eq(contact.id, contactId));
  if (!c) return { contactId: null, name: "", docType: "ci", doc: null, address: null };
  const canDoc = hasPermission(ctx, "contact.identity.read");
  const docType: ReceiverDocType =
    c.documentType === "rut" ? "rut" : c.documentType && c.documentType !== "ci" ? "other" : "ci";
  return {
    contactId: c.id,
    name: c.kind === "company" ? (c.companyName ?? c.displayName) : c.displayName,
    docType: c.kind === "company" && c.documentType === "rut" ? "rut" : docType,
    doc: canDoc ? c.documentNumber : null,
    address: c.address,
  };
}

const activeLineFor = (type: InvoiceSourceType, idCol: Parameters<typeof eq>[1]) =>
  notExists(
    sql`(select 1 from invoice_line il where il.source_type = ${type} and il.source_id = ${idCol} and il.active)`,
  );

/** Honorarios y comisiones de administración que todavía no se facturaron. */
export async function pendingToInvoice(db: DbOrTx, ctx: RequestContext) {
  requirePermission(ctx, "invoice.manage");
  const [commissions, settlements] = await Promise.all([
    db
      .select({
        c: dealCommission,
        dealCode: deal.code,
        operation: deal.operation,
        stage: deal.stage,
        clientContactId: deal.clientContactId,
        propertyId: deal.propertyId,
        propertyCode: property.code,
      })
      .from(dealCommission)
      .innerJoin(deal, eq(deal.id, dealCommission.dealId))
      .innerJoin(property, eq(property.id, deal.propertyId))
      .where(
        and(
          eq(dealCommission.organizationId, ctx.organizationId),
          isNull(deal.deletedAt),
          sql`${dealCommission.status} <> 'cancelled'`,
          sql`(${deal.stage} in ('signed', 'closed') or ${dealCommission.status} = 'collected')`,
          sql`${dealCommission.amountMinor} > 0`,
          activeLineFor("deal_commission", sql`${dealCommission.id}`),
        ),
      )
      .orderBy(desc(dealCommission.createdAt))
      .limit(300),
    db
      .select({
        s: ownerSettlement,
        period: rentCharge.period,
        contractCode: rentalContract.code,
      })
      .from(ownerSettlement)
      .innerJoin(rentCharge, eq(rentCharge.id, ownerSettlement.chargeId))
      .innerJoin(rentalContract, eq(rentalContract.id, ownerSettlement.contractId))
      .where(
        and(
          eq(ownerSettlement.organizationId, ctx.organizationId),
          inArray(ownerSettlement.status, ["approved", "paid"]),
          sql`${ownerSettlement.feeMinor} > 0`,
          activeLineFor("settlement_fee", sql`${ownerSettlement.id}`),
        ),
      )
      .orderBy(desc(rentCharge.period))
      .limit(300),
  ]);
  const ownersByProperty = new Map<string, string>();
  const propIds = [...new Set(commissions.map((c) => c.propertyId))];
  if (propIds.length) {
    const rows = await db
      .select({ propertyId: propertyOwner.propertyId, contactId: propertyOwner.contactId })
      .from(propertyOwner)
      .where(inArray(propertyOwner.propertyId, propIds))
      .orderBy(desc(propertyOwner.shareBasisPoints));
    for (const r of rows)
      if (!ownersByProperty.has(r.propertyId)) ownersByProperty.set(r.propertyId, r.contactId);
  }
  const items = [];
  for (const r of commissions) {
    const side = r.c.side as CommissionSide;
    const payerId =
      side === "buyer" || side === "tenant"
        ? r.clientContactId
        : (ownersByProperty.get(r.propertyId) ?? null);
    items.push({
      sourceType: "deal_commission" as const,
      sourceId: r.c.id,
      ref: r.dealCode,
      description: `Honorarios ${COMMISSION_SIDE_LABELS[side].toLowerCase()} · operación ${r.dealCode} · ${r.propertyCode}`,
      currency: r.c.currency,
      amountMinor: r.c.amountMinor.toString(),
      date: r.c.collectedAt ?? r.c.dueDate,
      collected: r.c.status === "collected",
      receiver: await receiverFor(db, ctx, payerId),
    });
  }
  for (const r of settlements) {
    const [y, m] = r.period.split("-");
    items.push({
      sourceType: "settlement_fee" as const,
      sourceId: r.s.id,
      ref: r.s.code,
      description: `Comisión de administración ${m}/${y} · contrato ${r.contractCode} (${r.s.code})`,
      currency: r.s.currency,
      amountMinor: r.s.feeMinor.toString(),
      date: r.s.paidAt,
      collected: r.s.status === "paid",
      receiver: await receiverFor(db, ctx, r.s.shares[0]?.contactId ?? null),
    });
  }
  return items;
}

async function assertSourcesFree(
  tx: DbOrTx,
  ctx: RequestContext,
  lines: { sourceType?: InvoiceSourceType | null; sourceId?: string | null }[],
  currency: Currency,
) {
  for (const l of lines) {
    if (!l.sourceType || !l.sourceId) continue;
    const [taken] = await tx
      .select({ id: invoiceLine.id })
      .from(invoiceLine)
      .where(
        and(
          eq(invoiceLine.sourceType, l.sourceType),
          eq(invoiceLine.sourceId, l.sourceId),
          eq(invoiceLine.active, true),
        ),
      );
    if (taken) throw new ConflictError("Uno de los conceptos ya está facturado");
    const [src] =
      l.sourceType === "deal_commission"
        ? await tx
            .select({ currency: dealCommission.currency })
            .from(dealCommission)
            .where(
              and(eq(dealCommission.id, l.sourceId), eq(dealCommission.organizationId, ctx.organizationId)),
            )
        : await tx
            .select({ currency: ownerSettlement.currency })
            .from(ownerSettlement)
            .where(
              and(eq(ownerSettlement.id, l.sourceId), eq(ownerSettlement.organizationId, ctx.organizationId)),
            );
    if (!src) throw new NotFoundError("Concepto a facturar");
    if (src.currency !== currency)
      throw new ValidationError("Todos los conceptos tienen que estar en la moneda de la factura", {
        currency: ["Moneda distinta a la de los conceptos"],
      });
  }
}

export async function createInvoice(db: Db, ctx: RequestContext, rawInput: unknown) {
  requirePermission(ctx, "invoice.manage");
  const input = parseInput(createInvoiceSchema, rawInput);
  return db.transaction(async (tx) => {
    if (input.contactId) {
      const [c] = await tx
        .select({ id: contact.id })
        .from(contact)
        .where(and(eq(contact.id, input.contactId), eq(contact.organizationId, ctx.organizationId)));
      if (!c) throw new NotFoundError("Contacto");
    }
    await assertSourcesFree(tx, ctx, input.lines, input.currency);
    const lines = input.lines.map((l, i) => {
      const amount = toMinor(l.amount);
      if (amount <= 0n)
        throw new ValidationError("Monto inválido", { [`lines.${i}.amount`]: ["Mayor a cero"] });
      const t = splitTax(amount, input.taxIncluded, IVA_BASIC_BP);
      return { ...l, position: i, netMinor: t.netMinor, taxMinor: t.taxMinor };
    });
    const subtotal = lines.reduce((s, l) => s + l.netMinor, 0n);
    const tax = lines.reduce((s, l) => s + l.taxMinor, 0n);
    const code = await nextCode(tx, ctx.organizationId, "FAC");
    const [row] = await tx
      .insert(invoice)
      .values({
        organizationId: ctx.organizationId,
        code,
        kind: invoiceKindFor(input.receiverDocType),
        contactId: input.contactId ?? null,
        receiverName: input.receiverName,
        receiverDocType: input.receiverDocType,
        receiverDoc: input.receiverDoc,
        receiverAddress: input.receiverAddress,
        currency: input.currency,
        taxIncluded: input.taxIncluded,
        subtotalMinor: subtotal,
        taxMinor: tax,
        totalMinor: subtotal + tax,
        notes: input.notes,
        createdById: ctx.userId,
      })
      .returning();
    if (!row) throw new Error("No se pudo crear la factura");
    await tx.insert(invoiceLine).values(
      lines.map((l) => ({
        organizationId: ctx.organizationId,
        invoiceId: row.id,
        position: l.position,
        description: l.description,
        netMinor: l.netMinor,
        taxRateBp: IVA_BASIC_BP,
        taxMinor: l.taxMinor,
        sourceType: l.sourceType ?? null,
        sourceId: l.sourceId ?? null,
      })),
    );
    await writeAudit(tx, ctx, {
      action: "invoice.create",
      entityType: "invoice",
      entityId: row.id,
      after: row,
    });
    return row;
  });
}

async function loadInvoice(tx: DbOrTx, ctx: RequestContext, id: string) {
  const [r] = await tx
    .select()
    .from(invoice)
    .where(and(eq(invoice.id, parseInput(uuidSchema, id)), eq(invoice.organizationId, ctx.organizationId)))
    .for("update");
  if (!r) throw new NotFoundError("Factura");
  return r;
}

/** Marca emitida con la serie y el número del CFE (emitido en DGI o un proveedor). */
export async function issueInvoice(db: Db, ctx: RequestContext, rawInput: unknown) {
  requirePermission(ctx, "invoice.manage");
  const input = parseInput(issueInvoiceSchema, rawInput);
  return db.transaction(async (tx) => {
    const before = await loadInvoice(tx, ctx, input.id);
    if (before.status !== "draft") throw new ConflictError("Solo se emiten borradores");
    const [dup] = await tx
      .select({ code: invoice.code })
      .from(invoice)
      .where(
        and(
          eq(invoice.organizationId, ctx.organizationId),
          eq(invoice.kind, before.kind),
          eq(invoice.cfeSeries, input.cfeSeries),
          eq(invoice.cfeNumber, input.cfeNumber),
        ),
      );
    if (dup)
      throw new ValidationError(`Ese número de CFE ya está en ${dup.code}`, {
        cfeNumber: ["Número repetido"],
      });
    const [after] = await tx
      .update(invoice)
      .set({
        status: "issued",
        cfeSeries: input.cfeSeries,
        cfeNumber: input.cfeNumber,
        issuedAt: input.issuedAt,
        issuedById: ctx.userId,
      })
      .where(eq(invoice.id, before.id))
      .returning();
    await writeAudit(tx, ctx, {
      action: "invoice.issue",
      entityType: "invoice",
      entityId: before.id,
      before,
      after,
    });
    return after;
  });
}

/** Anula una emitida (las fuentes vuelven a quedar para facturar) o borra un borrador. */
export async function voidInvoice(db: Db, ctx: RequestContext, rawInput: unknown) {
  requirePermission(ctx, "invoice.manage");
  const input = parseInput(voidInvoiceSchema, rawInput);
  return db.transaction(async (tx) => {
    const before = await loadInvoice(tx, ctx, input.id);
    if (before.status === "voided") throw new ConflictError("La factura ya está anulada");
    if (before.status === "draft") {
      await tx.delete(invoice).where(eq(invoice.id, before.id));
      await writeAudit(tx, ctx, {
        action: "invoice.delete_draft",
        entityType: "invoice",
        entityId: before.id,
        before: { ...before, reason: input.reason },
      });
      return { deleted: true };
    }
    await tx
      .update(invoice)
      .set({ status: "voided", voidReason: input.reason })
      .where(eq(invoice.id, before.id));
    await tx.update(invoiceLine).set({ active: false }).where(eq(invoiceLine.invoiceId, before.id));
    await writeAudit(tx, ctx, {
      action: "invoice.void",
      entityType: "invoice",
      entityId: before.id,
      before: { status: before.status },
      after: { status: "voided", reason: input.reason },
    });
    return { deleted: false };
  });
}

export async function listInvoices(
  db: DbOrTx,
  ctx: RequestContext,
  opts: { status?: InvoiceStatus | "all" } = {},
) {
  requirePermission(ctx, "invoice.read");
  const rows = await db
    .select({ i: invoice, by: user.name })
    .from(invoice)
    .leftJoin(user, eq(user.id, invoice.createdById))
    .where(
      and(
        eq(invoice.organizationId, ctx.organizationId),
        opts.status && opts.status !== "all" ? eq(invoice.status, opts.status) : undefined,
      ),
    )
    .orderBy(desc(invoice.createdAt))
    .limit(300);
  const totals: Record<Currency, bigint> = { USD: 0n, UYU: 0n };
  for (const r of rows) if (r.i.status === "issued") totals[r.i.currency] += r.i.totalMinor;
  return {
    items: rows.map((r) => ({ ...r.i, createdByName: r.by })),
    issuedTotals: totals,
    canManage: hasPermission(ctx, "invoice.manage"),
  };
}

export async function getInvoice(db: DbOrTx, ctx: RequestContext, id: string) {
  requirePermission(ctx, "invoice.read");
  const [i] = await db
    .select()
    .from(invoice)
    .where(and(eq(invoice.id, parseInput(uuidSchema, id)), eq(invoice.organizationId, ctx.organizationId)));
  if (!i) throw new NotFoundError("Factura");
  const lines = await db
    .select()
    .from(invoiceLine)
    .where(eq(invoiceLine.invoiceId, i.id))
    .orderBy(invoiceLine.position);
  return { invoice: i, lines };
}
