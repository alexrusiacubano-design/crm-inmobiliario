import { getCharge, getOrganization, NotFoundError, ValidationError } from "@crm/core";
import { getDb } from "@crm/db";
import {
  CHARGE_LINE_KIND_LABELS,
  CHARGE_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  type ChargeLineKind,
  type PaymentMethod,
} from "@crm/shared/billing";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatDay, price } from "@/components/properties/format";
import { PrintSheet, Row } from "@/components/print/sheet";
import { requirePagePermission } from "@/lib/session";
import { DEFAULT_TZ, ymdInTz } from "@/lib/tz";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Recibo" };

/** Estado de cuenta de la cuota con sus pagos: sirve como recibo para el inquilino. */
export default async function PrintCharge({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requirePagePermission("rent.read");
  const { id } = await params;
  const db = getDb();
  const today = ymdInTz(new Date(), ctx.organization.timezone || DEFAULT_TZ);
  const [org, data] = await Promise.all([
    getOrganization(db, ctx),
    getCharge(db, ctx, id, today).catch((e: unknown) => {
      if (e instanceof NotFoundError || e instanceof ValidationError) notFound();
      throw e;
    }),
  ]);
  const c = data.charge;
  const payments = data.payments.filter((p) => !p.voided && !p.voidsPaymentId);
  const [y, m] = c.period.split("-");
  return (
    <PrintSheet
      org={org}
      title={c.balanceMinor <= 0n ? "Recibo de alquiler" : "Estado de cuenta"}
      number={`${c.contractCode} · ${m}/${y}`}
      date={formatDateTime(new Date())}
      back={{ href: `/rentals/charges/${c.id}`, label: "Cuota" }}
    >
      <section className="mb-6 grid grid-cols-2 gap-4 text-[12px]">
        <div>
          <p className="text-neutral-500">Inquilino</p>
          <p className="font-medium">{c.tenantName}</p>
        </div>
        <div>
          <p className="text-neutral-500">Propiedad</p>
          <p className="font-medium">{c.propertyLabel}</p>
        </div>
        <div>
          <p className="text-neutral-500">Vencimiento</p>
          <p className="font-medium">{formatDay(c.dueDate)}</p>
        </div>
        <div>
          <p className="text-neutral-500">Estado</p>
          <p className="font-medium">{CHARGE_STATUS_LABELS[c.status]}</p>
        </div>
      </section>
      <section className="mb-6 max-w-[120mm]">
        <p className="mb-1 font-semibold">Conceptos</p>
        {data.lines.map((l) => (
          <Row
            key={l.id}
            label={`${CHARGE_LINE_KIND_LABELS[l.kind as ChargeLineKind]}${l.description ? ` · ${l.description}` : ""}`}
            value={`${l.kind === "discount" ? "− " : ""}${price(l.amountMinor, c.currency)}`}
          />
        ))}
        <Row label="Total de la cuota" value={price(c.totalMinor, c.currency)} strong />
      </section>
      <section className="max-w-[120mm]">
        <p className="mb-1 font-semibold">Pagos recibidos</p>
        {payments.length === 0 && <p className="text-neutral-500">Sin pagos registrados.</p>}
        {payments.map((p) => (
          <Row
            key={p.id}
            label={`${formatDay(p.paidAt)} · ${PAYMENT_METHOD_LABELS[p.method as PaymentMethod]}${p.reference ? ` · ${p.reference}` : ""}`}
            value={price(p.amountMinor, c.currency)}
          />
        ))}
        <Row label="Total pagado" value={price(c.paidMinor, c.currency)} strong />
        <Row label="Saldo" value={price(c.balanceMinor > 0n ? c.balanceMinor : 0n, c.currency)} strong />
      </section>
    </PrintSheet>
  );
}
