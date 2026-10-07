import { SETTLEMENT_STATUS_LABELS, type SettlementStatus } from "@crm/shared/billing";
import { formatBasisPoints } from "@crm/shared";
import { formatDay, price } from "@/components/properties/format";
import { Row } from "./sheet";

type Cur = "UYU" | "USD";
export interface SettlementView {
  code: string;
  period: string;
  currency: Cur;
  incomeMinor: bigint | string;
  feeMinor: bigint | string;
  deductionsMinor: bigint | string;
  netMinor: bigint | string;
  deductions: { description: string; amountMinor: string }[];
  shares: { contactId: string; name: string; shareBasisPoints: number; amountMinor: string }[];
  status: string;
  paidAt: string | null;
  reference: string | null;
  contractCode: string;
  tenantName: string;
  propertyLabel: string;
}

const month = (ymd: string) => {
  const [y, m] = ymd.split("-");
  return `${m}/${y}`;
};

/** Contenido de una liquidación al propietario. `onlyContactId` muestra solo esa parte (portal). */
export function SettlementDoc({ s, onlyContactId }: { s: SettlementView; onlyContactId?: string }) {
  const shares = onlyContactId ? s.shares.filter((x) => x.contactId === onlyContactId) : s.shares;
  return (
    <div className="grid gap-6">
      <section className="grid grid-cols-2 gap-4 text-[12px]">
        <div>
          <p className="text-neutral-500">Propiedad</p>
          <p className="font-medium">{s.propertyLabel}</p>
        </div>
        <div>
          <p className="text-neutral-500">Contrato · inquilino</p>
          <p className="font-medium">
            {s.contractCode} · {s.tenantName}
          </p>
        </div>
        <div>
          <p className="text-neutral-500">Período</p>
          <p className="font-medium">{month(s.period)}</p>
        </div>
        <div>
          <p className="text-neutral-500">Estado</p>
          <p className="font-medium">
            {SETTLEMENT_STATUS_LABELS[s.status as SettlementStatus]}
            {s.paidAt ? ` el ${formatDay(s.paidAt)}` : ""}
            {s.reference ? ` · ref. ${s.reference}` : ""}
          </p>
        </div>
      </section>
      <section className="max-w-[110mm]">
        <Row label="Cobrado al inquilino" value={price(s.incomeMinor, s.currency)} />
        <Row label="Comisión de administración" value={`− ${price(s.feeMinor, s.currency)}`} />
        {s.deductions.map((d, i) => (
          <Row key={i} label={d.description || "Descuento"} value={`− ${price(d.amountMinor, s.currency)}`} />
        ))}
        <Row label="Neto a liquidar" value={price(s.netMinor, s.currency)} strong />
      </section>
      {shares.length > 0 && (
        <section>
          <p className="mb-1 font-semibold">{onlyContactId ? "Tu parte" : "Reparto entre propietarios"}</p>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-neutral-300 text-left text-neutral-500">
                <th className="py-1 font-normal">Propietario</th>
                <th className="py-1 text-right font-normal">Participación</th>
                <th className="py-1 text-right font-normal">Importe</th>
              </tr>
            </thead>
            <tbody>
              {shares.map((x) => (
                <tr key={x.contactId} className="border-b border-neutral-200">
                  <td className="py-1">{x.name}</td>
                  <td className="py-1 text-right tabular-nums">{formatBasisPoints(x.shareBasisPoints)}</td>
                  <td className="py-1 text-right font-medium tabular-nums">
                    {price(x.amountMinor, s.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
