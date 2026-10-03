import { getContract, hasPermission, listGuarantees, NotFoundError, ValidationError } from "@crm/core";
import { getDb } from "@crm/db";
import { formatBasisPoints } from "@crm/shared";
import {
  ADJUSTMENT_INDEX_LABELS,
  RENT_CHANGE_REASON_LABELS,
  CONTRACT_STATUS_LABELS,
} from "@crm/shared/rentals";
import { MessageCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PropertyStatusBadge } from "@/components/properties/badges";
import { formatDay, price } from "@/components/properties/format";
import { ContractActions } from "@/components/rentals/contract-actions";
import { toGuaranteeView } from "@/components/rentals/guarantee-serialize";
import { GuaranteesPanel } from "@/components/rentals/guarantees-panel";
import { ContractAlertBadges, ContractStatusBadge } from "@/components/rentals/badges";
import { Card } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireSession } from "@/lib/session";
import { DEFAULT_TZ, ymdInTz } from "@/lib/tz";
import { cn, whatsappLink } from "@/lib/utils";

export const metadata: Metadata = { title: "Contrato" };

export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requireSession();
  const { id } = await params;
  const today = ymdInTz(new Date(), ctx.organization.timezone || DEFAULT_TZ);
  const data = await getContract(getDb(), ctx, id, today).catch((error: unknown) => {
    if (error instanceof NotFoundError || error instanceof ValidationError) notFound();
    throw error;
  });
  const { contract: c, property: p } = data;
  const guarantees = hasPermission(ctx, "guarantee.read")
    ? await listGuarantees(getDb(), ctx, { status: "all", contractId: c.id }, today)
    : null;
  const wa = whatsappLink(data.tenantPhone);

  const facts: [string, React.ReactNode][] = [
    [
      "Propiedad",
      <>
        <Link href={`/properties/${p.id}`} className="text-primary hover:underline">
          {p.code} · {p.label}
        </Link>
        <span className="mt-1 block">
          <PropertyStatusBadge status={p.status} />
        </span>
      </>,
    ],
    [
      "Inquilino",
      <>
        <Link href={`/crm/contacts/${c.tenantContactId}`} className="text-primary hover:underline">
          {data.tenantName}
        </Link>
        {wa && (
          <a
            href={wa}
            target="_blank"
            rel="noreferrer"
            className="ml-2 inline-flex items-center gap-1 text-xs text-success"
          >
            <MessageCircle className="size-3.5" /> WhatsApp
          </a>
        )}
      </>,
    ],
    [
      "Propietario",
      data.owners.length
        ? data.owners.map((o) => (
            <Link
              key={o.contactId}
              href={`/crm/contacts/${o.contactId}?tab=owner`}
              className="block text-primary hover:underline"
            >
              {o.name}
              {data.owners.length > 1 ? ` (${formatBasisPoints(o.share)})` : ""}
            </Link>
          ))
        : "Sin propietario cargado",
    ],
    ["Plazo", `${formatDay(c.startDate)} al ${formatDay(c.endDate)}`],
    [
      "Alquiler vigente",
      <span className="text-lg font-semibold text-primary">{price(c.rentMinor, c.currency)}</span>,
    ],
    ["Día de pago", `Hasta el ${c.paymentDay} de cada mes`],
    [
      "Ajuste",
      c.adjustmentIndex === "none"
        ? ADJUSTMENT_INDEX_LABELS.none
        : `${ADJUSTMENT_INDEX_LABELS[c.adjustmentIndex]}${c.fixedAdjustmentBasisPoints ? ` ${formatBasisPoints(c.fixedAdjustmentBasisPoints)}` : ""} cada ${c.adjustmentMonths} meses`,
    ],
    ["Próximo ajuste", formatDay(c.nextAdjustmentAt)],
    [
      "Depósito",
      c.depositMinor !== null && c.depositCurrency ? price(c.depositMinor, c.depositCurrency) : "—",
    ],
    ["Garantía", c.guaranteeNote ?? "—"],
    [
      "Comisión de administración",
      c.adminFeeBasisPoints !== null ? formatBasisPoints(c.adminFeeBasisPoints) : "—",
    ],
    ["Responsable", data.assignedName ?? "—"],
  ];

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4 pb-5">
        <div>
          <p className="text-xs text-muted-foreground">
            <Link href="/rentals/contracts" className="hover:underline">
              Contratos
            </Link>{" "}
            / <span className="font-mono">{c.code}</span>
          </p>
          <h1 className="mt-0.5 text-xl font-semibold tracking-tight">{p.address || p.label}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            <ContractStatusBadge status={c.status} />
            <ContractAlertBadges alerts={data.alerts} />
            {p.zone && <span>· {p.zone}</span>}
            {data.deal && (
              <span>
                · desde la operación{" "}
                <Link
                  href={`/commercial/deals/${data.deal.id}`}
                  className="font-mono text-primary hover:underline"
                >
                  {data.deal.code}
                </Link>
              </span>
            )}
          </div>
          {c.status !== "active" && c.closedAt && (
            <p className="mt-1 text-sm text-muted-foreground">
              {CONTRACT_STATUS_LABELS[c.status]} el {formatDay(c.closedAt)}
              {c.closeReason ? ` · ${c.closeReason}` : ""}
            </p>
          )}
        </div>
        {data.canManage && c.status === "active" && (
          <ContractActions
            contractId={c.id}
            currency={c.currency}
            rentMinor={c.rentMinor.toString()}
            endDate={c.endDate}
            nextAdjustmentAt={c.nextAdjustmentAt}
            today={today}
          />
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <h2 className="border-b px-4 py-3 text-sm font-semibold">Condiciones</h2>
          <dl className="divide-y text-sm">
            {facts.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[11rem_1fr] gap-3 px-4 py-2">
                <dt className="text-muted-foreground">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          {c.notes && <p className="border-t px-4 py-3 text-sm whitespace-pre-wrap">{c.notes}</p>}
        </Card>

        <div className="grid content-start gap-5">
          {guarantees && (
            <GuaranteesPanel
              items={guarantees.items.map(toGuaranteeView)}
              canManage={guarantees.canManage && c.status === "active"}
              tenant={{ id: c.tenantContactId, label: data.tenantName }}
              contractId={c.id}
            />
          )}
          <Card>
            <h2 className="border-b px-4 py-3 text-sm font-semibold">Historial del alquiler</h2>
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Desde</TH>
                  <TH>Motivo</TH>
                  <TH className="text-right">Monto</TH>
                  <TH className="text-right">Variación</TH>
                  <TH>Cargó</TH>
                </TR>
              </THead>
              <TBody>
                {data.rents.map((r) => (
                  <TR key={r.id}>
                    <TD>{formatDay(r.effectiveFrom)}</TD>
                    <TD>
                      {RENT_CHANGE_REASON_LABELS[r.reason]}
                      {r.note && <span className="block text-xs text-muted-foreground">{r.note}</span>}
                    </TD>
                    <TD className="text-right font-semibold tabular">{price(r.amountMinor, r.currency)}</TD>
                    <TD className={cn("text-right tabular", (r.basisPoints ?? 0) < 0 && "text-danger")}>
                      {r.basisPoints
                        ? `${r.basisPoints > 0 ? "+" : "−"}${formatBasisPoints(Math.abs(r.basisPoints))}`
                        : "—"}
                    </TD>
                    <TD className="text-muted-foreground">{r.actorName ?? "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>

          {data.chain.length > 1 && (
            <Card>
              <h2 className="border-b px-4 py-3 text-sm font-semibold">
                Contratos con este inquilino en la propiedad
              </h2>
              <ul className="divide-y text-sm">
                {data.chain.map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-3 px-4 py-2">
                    <Link
                      href={`/rentals/contracts/${x.id}`}
                      className={cn(
                        "font-mono text-xs hover:underline",
                        x.id === c.id ? "font-bold" : "text-primary",
                      )}
                    >
                      {x.code}
                    </Link>
                    <span className="text-muted-foreground">
                      {formatDay(x.startDate)} → {formatDay(x.endDate)}
                    </span>
                    <ContractStatusBadge status={x.status} />
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
