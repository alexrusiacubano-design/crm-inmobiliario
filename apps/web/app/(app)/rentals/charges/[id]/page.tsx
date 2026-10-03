import { getCharge, hasPermission, listSettlements, NotFoundError, ValidationError } from "@crm/core";
import { getDb } from "@crm/db";
import {
  CHARGE_LINE_KIND_LABELS,
  PAYMENT_METHOD_LABELS,
  periodLabel,
  SETTLEMENT_STATUS_LABELS,
} from "@crm/shared/billing";
import { formatBasisPoints } from "@crm/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDay, price } from "@/components/properties/format";
import {
  ChargeLineDialog,
  PaymentDialog,
  SettlementActions,
  SettlementDialog,
  VoidPaymentButton,
} from "@/components/rentals/billing-controls";
import { ChargeStatusBadge } from "@/components/rentals/charge-badge";
import { Badge, Card } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireSession } from "@/lib/session";
import { capitalizeFirst, DEFAULT_TZ, ymdInTz } from "@/lib/tz";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Cuota de alquiler" };

export default async function ChargePage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requireSession();
  const { id } = await params;
  const today = ymdInTz(new Date(), ctx.organization.timezone || DEFAULT_TZ);
  const db = getDb();
  const data = await getCharge(db, ctx, id, today).catch((error: unknown) => {
    if (error instanceof NotFoundError || error instanceof ValidationError) notFound();
    throw error;
  });
  const c = data.charge;
  const settlements = hasPermission(ctx, "settlement.read")
    ? (await listSettlements(db, ctx, { status: "all", contractId: c.contractId })).items.filter(
        (s) => s.chargeId === c.id,
      )
    : [];
  const active = settlements.find((s) => s.status !== "voided");
  const canPay = hasPermission(ctx, "payment.register") && c.balanceMinor > 0n;
  const canLine = hasPermission(ctx, "rent.manage") && (!active || active.status === "draft");
  const canVoid = hasPermission(ctx, "payment.void") && !active;
  const canSettle = hasPermission(ctx, "settlement.manage") && !active && c.paidMinor > 0n;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4 pb-5">
        <div>
          <p className="text-xs text-muted-foreground">
            <Link href={`/rentals/charges?period=${c.period.slice(0, 7)}`} className="hover:underline">
              Cobros
            </Link>{" "}
            / {capitalizeFirst(periodLabel(c.period))}
          </p>
          <h1 className="mt-0.5 text-xl font-semibold tracking-tight">{c.propertyLabel}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            <ChargeStatusBadge status={c.status} daysLate={c.daysLate} />
            <Link
              href={`/rentals/contracts/${c.contractId}`}
              className="font-mono text-primary hover:underline"
            >
              {c.contractCode}
            </Link>
            · {c.tenantName} · vence el {formatDay(c.dueDate)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canPay && (
            <PaymentDialog
              chargeId={c.id}
              balanceMinor={c.balanceMinor.toString()}
              currency={c.currency}
              today={today}
            />
          )}
          {canLine && <ChargeLineDialog chargeId={c.id} />}
          {canSettle && <SettlementDialog chargeId={c.id} collectedLabel={price(c.paidMinor, c.currency)} />}
        </div>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        {(
          [
            ["Total", price(c.totalMinor, c.currency)],
            ["Cobrado", price(c.paidMinor, c.currency)],
            ["Saldo", price(c.balanceMinor, c.currency)],
          ] as const
        ).map(([k, v]) => (
          <Card
            key={k}
            className={cn(
              "p-4",
              k === "Saldo" && c.status === "overdue" && "border-danger/50 bg-danger-soft/30",
            )}
          >
            <p className="text-xs text-muted-foreground">{k}</p>
            <p className="mt-1 text-xl font-semibold tabular">{v}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="border-b px-4 py-3 text-sm font-semibold">Conceptos</h2>
          <Table>
            <TBody>
              {data.lines.map((l) => (
                <TR key={l.id}>
                  <TD>
                    {CHARGE_LINE_KIND_LABELS[l.kind]}
                    {l.description && l.description !== CHARGE_LINE_KIND_LABELS[l.kind] && (
                      <span className="block text-xs text-muted-foreground">{l.description}</span>
                    )}
                  </TD>
                  <TD className={cn("text-right tabular", l.kind === "discount" && "text-success")}>
                    {l.kind === "discount" ? "− " : ""}
                    {price(l.amountMinor, c.currency)}
                  </TD>
                </TR>
              ))}
              <TR className="font-semibold">
                <TD>Total</TD>
                <TD className="text-right tabular">{price(c.totalMinor, c.currency)}</TD>
              </TR>
            </TBody>
          </Table>
        </Card>

        <Card>
          <h2 className="border-b px-4 py-3 text-sm font-semibold">Pagos</h2>
          {data.payments.length === 0 ? (
            <p className="px-4 py-5 text-sm text-muted-foreground">Todavía no hay pagos registrados.</p>
          ) : (
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Fecha</TH>
                  <TH>Medio</TH>
                  <TH className="text-right">Monto</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {data.payments.map((p) => (
                  <TR key={p.id} className={cn((p.voided || p.voidsPaymentId) && "text-muted-foreground")}>
                    <TD>
                      {formatDay(p.paidAt)}
                      <span className="block text-xs text-muted-foreground">{p.receivedByName ?? ""}</span>
                    </TD>
                    <TD>
                      {p.voidsPaymentId
                        ? `Contra-asiento · ${p.voidReason ?? ""}`
                        : PAYMENT_METHOD_LABELS[p.method]}
                      {p.reference && !p.voidsPaymentId && (
                        <span className="block text-xs text-muted-foreground">{p.reference}</span>
                      )}
                    </TD>
                    <TD
                      className={cn(
                        "text-right tabular",
                        p.amountMinor < 0n && "text-danger",
                        p.voided && "line-through",
                      )}
                    >
                      {price(p.amountMinor, c.currency)}
                    </TD>
                    <TD className="text-right">
                      {canVoid && !p.voided && !p.voidsPaymentId && <VoidPaymentButton paymentId={p.id} />}
                      {p.voided && <Badge tone="neutral">Anulado</Badge>}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        {settlements.map((s) => (
          <Card key={s.id} className="lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
              <h2 className="text-sm font-semibold">
                Liquidación <span className="font-mono">{s.code}</span>{" "}
                <Badge tone={s.status === "paid" ? "success" : s.status === "voided" ? "neutral" : "warning"}>
                  {SETTLEMENT_STATUS_LABELS[s.status]}
                </Badge>
              </h2>
              {hasPermission(ctx, "settlement.manage") && (
                <SettlementActions id={s.id} status={s.status} today={today} />
              )}
            </div>
            <div className="grid gap-4 p-4 text-sm sm:grid-cols-2">
              <dl className="grid gap-1">
                <div className="flex justify-between">
                  <dt>Cobrado al inquilino</dt>
                  <dd className="tabular">{price(s.incomeMinor, s.currency)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Comisión de administración</dt>
                  <dd className="tabular">− {price(s.feeMinor, s.currency)}</dd>
                </div>
                {s.deductions.map((d, i) => (
                  <div key={i} className="flex justify-between">
                    <dt>{d.description}</dt>
                    <dd className="tabular">− {price(d.amountMinor, s.currency)}</dd>
                  </div>
                ))}
                <div className="flex justify-between border-t pt-1 font-semibold">
                  <dt>Neto al propietario</dt>
                  <dd className="tabular">{price(s.netMinor, s.currency)}</dd>
                </div>
              </dl>
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Reparto</p>
                <ul className="grid gap-1">
                  {s.shares.map((sh) => (
                    <li key={sh.contactId} className="flex justify-between">
                      <Link
                        href={`/crm/contacts/${sh.contactId}?tab=owner`}
                        className="text-primary hover:underline"
                      >
                        {sh.name} ({formatBasisPoints(sh.shareBasisPoints)})
                      </Link>
                      <span className="tabular">{price(sh.amountMinor, s.currency)}</span>
                    </li>
                  ))}
                </ul>
                {s.status === "paid" && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Pagada el {formatDay(s.paidAt)}
                    {s.reference ? ` · ${s.reference}` : ""}
                  </p>
                )}
                {s.voidReason && (
                  <p className="mt-2 text-xs text-muted-foreground">Anulada: {s.voidReason}</p>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
