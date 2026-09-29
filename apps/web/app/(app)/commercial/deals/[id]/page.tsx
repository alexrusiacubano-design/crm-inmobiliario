import {
  contractForDeal,
  dealOffers,
  getDeal,
  hasPermission,
  listDealUsers,
  NotFoundError,
  ValidationError,
} from "@crm/core";
import { getDb } from "@crm/db";
import { dealStageLabel, PROPERTY_OPERATION_LABELS } from "@crm/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CommissionsCard, DealStageControls, ParticipantsCard } from "@/components/deals/deal-controls";
import { OffersCard } from "@/components/deals/offers-card";
import { NewContractButton } from "@/components/rentals/new-contract-dialog";
import { DEFAULT_TZ, ymdInTz } from "@/lib/tz";
import { formatDateTime } from "@/lib/utils";
import { PropertyStatusBadge } from "@/components/properties/badges";
import { formatDay, price } from "@/components/properties/format";
import { Badge, Card } from "@/components/ui/misc";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Operación" };

export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requireSession();
  const { id } = await params;
  const db = getDb();
  const data = await getDeal(db, ctx, id).catch((error: unknown) => {
    if (error instanceof NotFoundError || error instanceof ValidationError) notFound();
    throw error;
  });
  const { deal: d, property: p, permissions: can } = data;
  const [users, negotiation] = await Promise.all([
    can.manage || can.commissions ? listDealUsers(db, ctx) : Promise.resolve([]),
    dealOffers(db, ctx, d.id),
  ]);
  const contract = d.operation !== "sale" ? await contractForDeal(db, ctx, d.id) : null;
  const canContract =
    d.operation !== "sale" &&
    !contract &&
    ["notary", "signed", "closed"].includes(d.stage) &&
    hasPermission(ctx, "contract.manage");
  const today = ymdInTz(new Date(), ctx.organization.timezone || DEFAULT_TZ);
  const open = d.stage !== "closed" && d.stage !== "fallen";

  return (
    <>
      <div className="pb-5">
        <p className="text-xs text-muted-foreground">
          <Link href="/commercial/deals" className="hover:underline">
            Operaciones
          </Link>{" "}
          / <span className="font-mono">{d.code}</span>
        </p>
        <h1 className="mt-0.5 text-xl font-semibold tracking-tight">{p.address || p.label}</h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
          <Badge tone="primary">{PROPERTY_OPERATION_LABELS[d.operation]}</Badge>
          <Badge tone={d.stage === "closed" ? "success" : d.stage === "fallen" ? "danger" : "warning"}>
            {dealStageLabel(d.stage, d.operation)}
          </Badge>
          <span>· Responsable: {data.assignedName ?? "—"}</span>
        </div>
      </div>

      <DealStageControls
        dealId={d.id}
        stage={d.stage}
        operation={d.operation}
        canManage={can.manage}
        canClose={can.close}
        reservationFlow={negotiation.canManageReservations}
        activeReservation={negotiation.reservations.some((r) => r.status === "active")}
      />
      {(contract || canContract) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border bg-primary-soft/40 px-4 py-2 text-sm">
          {contract ? (
            <>
              Contrato de alquiler:{" "}
              <Link
                href={`/rentals/contracts/${contract.id}`}
                className="font-mono text-primary hover:underline"
              >
                {contract.code}
              </Link>
            </>
          ) : (
            <>
              <span>Con el contrato firmado, cargalo para seguir vencimientos y ajustes.</span>
              <NewContractButton
                label="Crear contrato"
                preset={{
                  dealId: d.id,
                  property: { id: p.id, label: `${p.code} · ${p.label}` },
                  tenant: { id: d.clientContactId, label: data.clientName },
                  currency: d.currency,
                  rent: (d.priceMinor / 100n).toString(),
                }}
              />
            </>
          )}
        </div>
      )}
      {d.stage === "fallen" && d.fallenReason && (
        <p className="mt-2 text-sm text-muted-foreground">Motivo: {d.fallenReason}</p>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {(negotiation.offers.length > 0 ||
          negotiation.reservations.length > 0 ||
          (open && (negotiation.canManageOffers || negotiation.canManageReservations))) && (
          <OffersCard
            dealId={d.id}
            stage={d.stage}
            operation={d.operation}
            defaultCurrency={d.currency}
            today={today}
            canManageOffers={negotiation.canManageOffers}
            canManageReservations={negotiation.canManageReservations}
            canManageDeal={can.manage}
            offers={negotiation.offers.map((o) => ({
              id: o.id,
              party: o.party,
              currency: o.currency,
              amountMinor: o.amountMinor.toString(),
              conditions: o.conditions,
              validUntil: o.validUntil,
              status: o.status,
              responseNote: o.responseNote,
              createdAtLabel: formatDateTime(o.createdAt),
              createdByName: o.createdByName,
            }))}
            reservations={negotiation.reservations.map((r) => ({
              id: r.id,
              currency: r.currency,
              depositMinor: r.depositMinor.toString(),
              receivedAt: r.receivedAt,
              expiresAt: r.expiresAt,
              holder: r.holder,
              receiptNumber: r.receiptNumber,
              status: r.status,
              notes: r.notes,
              cancelReason: r.cancelReason,
              refundedAt: r.refundedAt,
            }))}
          />
        )}
        <Card>
          <h2 className="border-b px-4 py-3 text-sm font-semibold">Datos</h2>
          <dl className="grid gap-3 p-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Propiedad</dt>
              <dd>
                <Link href={`/properties/${p.id}`} className="text-primary hover:underline">
                  {p.code} · {p.label}
                </Link>
                <span className="mt-1 block">
                  <PropertyStatusBadge status={p.status} />
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {d.operation === "sale" ? "Comprador" : "Inquilino"}
              </dt>
              <dd>
                <Link href={`/crm/contacts/${d.clientContactId}`} className="text-primary hover:underline">
                  {data.clientName}
                </Link>
                {data.leadCode && d.leadId && (
                  <Link
                    href={`/crm/leads/${d.leadId}`}
                    className="block text-xs text-muted-foreground hover:underline"
                  >
                    {data.leadCode}
                  </Link>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {d.operation === "sale" ? "Precio acordado" : "Alquiler acordado"}
              </dt>
              <dd className="text-lg font-semibold text-primary">{price(d.priceMinor, d.currency)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {d.stage === "closed" ? "Firmada" : "Firma estimada"}
              </dt>
              <dd>{formatDay(d.stage === "closed" ? d.closedAt : d.expectedCloseDate)}</dd>
            </div>
            {d.notes && (
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">Notas</dt>
                <dd className="whitespace-pre-wrap">{d.notes}</dd>
              </div>
            )}
          </dl>
        </Card>

        {can.seeMoney ? (
          <CommissionsCard
            dealId={d.id}
            operation={d.operation}
            defaultCurrency={d.currency}
            items={data.commissions}
            canEdit={can.commissions}
            canCollect={can.collect}
            locked={!open && d.stage === "fallen"}
          />
        ) : (
          <Card className="p-4 text-sm text-muted-foreground">Tu rol no incluye los honorarios.</Card>
        )}

        <ParticipantsCard
          dealId={d.id}
          items={data.participants}
          users={users}
          canEdit={(can.manage || can.commissions) && d.stage !== "fallen"}
        />
      </div>
    </>
  );
}
