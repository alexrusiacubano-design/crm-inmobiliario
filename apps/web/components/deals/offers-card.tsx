"use client";

import { ArrowRightLeft, CalendarPlus, Check, HandCoins, Plus, Undo2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  daysBetween,
  DEPOSIT_HOLDER_LABELS,
  DEPOSIT_HOLDERS,
  isOfferExpired,
  OFFER_PARTY_LABELS,
  OFFER_STATUS_LABELS,
  RESERVATION_STATUS_LABELS,
  otherParty,
  type DepositHolder,
  type OfferParty,
  type OfferStatus,
  type ReservationStatus,
} from "@crm/shared/offers";
import {
  cancelReservationAction,
  createOfferAction,
  createReservationAction,
  extendReservationAction,
  respondOfferAction,
} from "@/app/(app)/commercial/deals/actions";
import { formatDay, price } from "@/components/properties/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { Badge, Card } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

type Currency = "USD" | "UYU";

export interface OfferView {
  id: string;
  party: OfferParty;
  currency: Currency;
  amountMinor: string;
  conditions: string | null;
  validUntil: string | null;
  status: OfferStatus;
  responseNote: string | null;
  /** Formateada en el servidor (evita diferencias de hidratación). */
  createdAtLabel: string;
  createdByName: string | null;
}

export interface ReservationView {
  id: string;
  currency: Currency;
  depositMinor: string;
  receivedAt: string;
  expiresAt: string;
  holder: DepositHolder;
  receiptNumber: string | null;
  status: ReservationStatus;
  notes: string | null;
  cancelReason: string | null;
  refundedAt: string | null;
}

const OFFER_TONE: Record<OfferStatus, "warning" | "primary" | "success" | "danger" | "neutral"> = {
  pending: "warning",
  countered: "primary",
  accepted: "success",
  rejected: "danger",
  withdrawn: "neutral",
};

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const run = (
    fn: () => Promise<{ ok: boolean; error?: string; fieldErrors?: Record<string, string[]> }>,
    ok: string,
    after?: () => void,
  ) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        return void toast.error(r.error);
      }
      setErrors({});
      toast.success(ok);
      after?.();
      router.refresh();
    });
  return { pending, errors, run, setErrors };
}

const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function OfferDialog({
  title,
  dealId,
  offerId,
  defaultParty,
  defaultCurrency,
  today,
  trigger,
}: {
  title: string;
  dealId: string;
  /** Si viene, es una contraoferta a esa oferta. */
  offerId?: string;
  defaultParty: OfferParty;
  defaultCurrency: Currency;
  today: string;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [party, setParty] = useState<OfferParty>(defaultParty);
  const [currency, setCurrency] = useState<Currency>(defaultCurrency);
  const [amount, setAmount] = useState("");
  const [conditions, setConditions] = useState("");
  const [validUntil, setValidUntil] = useState(addDays(today, 3));
  const [note, setNote] = useState("");
  const { pending, errors, run, setErrors } = useRun();
  const counter = Boolean(offerId);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setParty(defaultParty);
          setCurrency(defaultCurrency);
          setAmount("");
          setConditions("");
          setValidUntil(addDays(today, 3));
          setNote("");
          setErrors({});
        }
        setOpen(o);
      }}
    >
      <span onClick={() => setOpen(true)}>{trigger}</span>
      <DialogContent
        title={title}
        description={
          counter
            ? `Contraoferta del ${OFFER_PARTY_LABELS[defaultParty].toLowerCase()}. La oferta anterior queda como contraofertada.`
            : "Queda registrada con fecha y autor; el monto no se edita después."
        }
      >
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                counter
                  ? respondOfferAction({
                      offerId,
                      response: "counter",
                      currency,
                      amount,
                      conditions,
                      validUntil,
                      note,
                    })
                  : createOfferAction({ dealId, party, currency, amount, conditions, validUntil }),
              counter ? "Contraoferta registrada" : "Oferta registrada",
              () => setOpen(false),
            );
          }}
        >
          <div className="grid gap-4 sm:grid-cols-3">
            {!counter && (
              <Field label="Ofrece" htmlFor="of-p">
                <Select id="of-p" value={party} onChange={(e) => setParty(e.target.value as OfferParty)}>
                  <option value="client">Cliente</option>
                  <option value="owner">Propietario</option>
                </Select>
              </Field>
            )}
            <Field label="Moneda" htmlFor="of-c">
              <Select id="of-c" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
                <option value="USD">U$S</option>
                <option value="UYU">$ (UYU)</option>
              </Select>
            </Field>
            <Field label="Monto" htmlFor="of-a" error={errors.amount}>
              <Input
                id="of-a"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                autoFocus
              />
            </Field>
          </div>
          <Field label="Condiciones" htmlFor="of-cond" hint="Forma de pago, plazos, qué incluye…">
            <Textarea
              id="of-cond"
              rows={2}
              value={conditions}
              onChange={(e) => setConditions(e.target.value)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Válida hasta" htmlFor="of-v" error={errors.validUntil}>
              <Input
                id="of-v"
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
              />
            </Field>
            {counter && (
              <Field label="Nota" htmlFor="of-n">
                <Input id="of-n" value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              Registrar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReservationDialog({
  dealId,
  defaultCurrency,
  today,
}: {
  dealId: string;
  defaultCurrency: Currency;
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const [currency, setCurrency] = useState<Currency>(defaultCurrency);
  const [deposit, setDeposit] = useState("");
  const [receivedAt, setReceivedAt] = useState(today);
  const [expiresAt, setExpiresAt] = useState(addDays(today, 15));
  const [holder, setHolder] = useState<DepositHolder>("agency");
  const [receipt, setReceipt] = useState("");
  const [notes, setNotes] = useState("");
  const { pending, errors, run } = useRun();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" onClick={() => setOpen(true)}>
        <HandCoins /> Registrar reserva
      </Button>
      <DialogContent
        title="Registrar reserva"
        description="La operación y la propiedad pasan a Reservada. La seña queda registrada con quién la tiene y hasta cuándo vale."
      >
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                createReservationAction({
                  dealId,
                  currency,
                  deposit,
                  receivedAt,
                  expiresAt,
                  holder,
                  receiptNumber: receipt,
                  notes,
                }),
              "Reserva registrada",
              () => setOpen(false),
            );
          }}
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Moneda" htmlFor="rs-c">
              <Select id="rs-c" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
                <option value="USD">U$S</option>
                <option value="UYU">$ (UYU)</option>
              </Select>
            </Field>
            <Field label="Seña" htmlFor="rs-d" error={errors.deposit}>
              <Input
                id="rs-d"
                inputMode="decimal"
                value={deposit}
                onChange={(e) => setDeposit(e.target.value)}
                autoFocus
              />
            </Field>
            <Field label="La tiene" htmlFor="rs-h">
              <Select id="rs-h" value={holder} onChange={(e) => setHolder(e.target.value as DepositHolder)}>
                {DEPOSIT_HOLDERS.map((h) => (
                  <option key={h} value={h}>
                    {DEPOSIT_HOLDER_LABELS[h]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Cobrada el" htmlFor="rs-r" error={errors.receivedAt}>
              <Input
                id="rs-r"
                type="date"
                value={receivedAt}
                onChange={(e) => setReceivedAt(e.target.value)}
              />
            </Field>
            <Field
              label="Vence el"
              htmlFor="rs-e"
              error={errors.expiresAt}
              hint="Plazo para firmar boleto o contrato"
            >
              <Input id="rs-e" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            </Field>
            <Field label="N.º de recibo" htmlFor="rs-n">
              <Input id="rs-n" value={receipt} onChange={(e) => setReceipt(e.target.value)} />
            </Field>
          </div>
          <Field label="Notas" htmlFor="rs-notes">
            <Textarea id="rs-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              Registrar reserva
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ExtendDialog({ r, today }: { r: ReservationView; today: string }) {
  const [open, setOpen] = useState(false);
  const [expiresAt, setExpiresAt] = useState(addDays(r.expiresAt < today ? today : r.expiresAt, 15));
  const [note, setNote] = useState("");
  const { pending, errors, run } = useRun();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <CalendarPlus /> Prorrogar
      </Button>
      <DialogContent title="Prorrogar reserva" description={`Vence hoy el ${formatDay(r.expiresAt)}.`}>
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => extendReservationAction({ reservationId: r.id, expiresAt, note }),
              "Reserva prorrogada",
              () => setOpen(false),
            );
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nuevo vencimiento" htmlFor="ex-d" error={errors.expiresAt}>
              <Input id="ex-d" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            </Field>
            <Field label="Motivo" htmlFor="ex-n">
              <Input id="ex-n" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              Prorrogar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({
  r,
  today,
  canNegotiate,
}: {
  r: ReservationView;
  today: string;
  canNegotiate: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<"refunded" | "forfeited">("refunded");
  const [reason, setReason] = useState("");
  const [refundedAt, setRefundedAt] = useState(today);
  const [back, setBack] = useState(false);
  const { pending, errors, run } = useRun();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <X /> Cancelar reserva
      </Button>
      <DialogContent
        title="Cancelar reserva"
        description={`Seña de ${price(r.depositMinor, r.currency)}. Indicá qué pasa con la seña y con la operación.`}
      >
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                cancelReservationAction({
                  reservationId: r.id,
                  outcome,
                  reason,
                  refundedAt: outcome === "refunded" ? refundedAt : null,
                  backToNegotiation: back,
                }),
              "Reserva cancelada",
              () => setOpen(false),
            );
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="La seña" htmlFor="cr-o">
              <Select
                id="cr-o"
                value={outcome}
                onChange={(e) => setOutcome(e.target.value as "refunded" | "forfeited")}
              >
                <option value="refunded">Se devuelve</option>
                <option value="forfeited">Se retiene (la pierde quien reservó)</option>
              </Select>
            </Field>
            {outcome === "refunded" && (
              <Field label="Devuelta el" htmlFor="cr-d" error={errors.refundedAt}>
                <Input
                  id="cr-d"
                  type="date"
                  value={refundedAt}
                  onChange={(e) => setRefundedAt(e.target.value)}
                />
              </Field>
            )}
          </div>
          <Field label="Motivo" htmlFor="cr-r" error={errors.reason}>
            <Textarea id="cr-r" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {canNegotiate && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={back} onChange={(e) => setBack(e.target.checked)} />
              Seguir negociando (si no, la operación se cae y la propiedad vuelve a estar disponible)
            </label>
          )}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Volver
            </Button>
            <Button type="submit" variant="danger" loading={pending}>
              Cancelar reserva
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function OfferActions({ o }: { o: OfferView }) {
  const { pending, run } = useRun();
  const respond = (response: "accept" | "reject" | "withdraw", ok: string) => {
    const note = response === "accept" ? null : (window.prompt("Nota (opcional)") ?? null);
    run(() => respondOfferAction({ offerId: o.id, response, note }), ok);
  };
  return (
    <>
      <Button size="sm" disabled={pending} onClick={() => respond("accept", "Oferta aceptada")}>
        <Check /> Aceptar
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => respond("reject", "Oferta rechazada")}
      >
        <X /> Rechazar
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => respond("withdraw", "Oferta retirada")}
      >
        <Undo2 /> Retirada
      </Button>
    </>
  );
}

export function OffersCard({
  dealId,
  stage,
  operation,
  defaultCurrency,
  offers,
  reservations,
  canManageOffers,
  canManageReservations,
  canManageDeal,
  today,
}: {
  dealId: string;
  stage: string;
  operation: string;
  defaultCurrency: Currency;
  offers: OfferView[];
  reservations: ReservationView[];
  canManageOffers: boolean;
  canManageReservations: boolean;
  canManageDeal: boolean;
  today: string;
}) {
  const pendingOffer = offers.find((o) => o.status === "pending");
  const active = reservations.find((r) => r.status === "active");
  const past = reservations.filter((r) => r.status !== "active");
  const negotiating = stage === "negotiation";
  const reservable = (negotiating || stage === "reserved") && !active && !pendingOffer;
  const clientWord = operation === "sale" ? "comprador" : "inquilino";

  return (
    <Card className="lg:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
        <h2 className="text-sm font-semibold">Ofertas y reserva</h2>
        <div className="flex flex-wrap gap-2">
          {canManageOffers && negotiating && !pendingOffer && (
            <OfferDialog
              title="Nueva oferta"
              dealId={dealId}
              defaultParty="client"
              defaultCurrency={defaultCurrency}
              today={today}
              trigger={
                <Button size="sm" variant="secondary">
                  <Plus /> Nueva oferta
                </Button>
              }
            />
          )}
          {canManageReservations && reservable && (
            <ReservationDialog dealId={dealId} defaultCurrency={defaultCurrency} today={today} />
          )}
        </div>
      </div>

      {active && (
        <div
          className={cn(
            "border-b px-4 py-3",
            active.expiresAt < today
              ? "bg-danger-soft/40"
              : daysBetween(today, active.expiresAt) <= 7
                ? "bg-warning-soft/40"
                : "bg-success-soft/30",
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">
                Reserva vigente · seña {price(active.depositMinor, active.currency)}
              </p>
              <p className="text-xs text-muted-foreground">
                Cobrada el {formatDay(active.receivedAt)} · la tiene{" "}
                {DEPOSIT_HOLDER_LABELS[active.holder].toLowerCase()}
                {active.receiptNumber ? ` · recibo ${active.receiptNumber}` : ""} · vence el{" "}
                {formatDay(active.expiresAt)}{" "}
                <strong>
                  {active.expiresAt < today
                    ? "(vencida)"
                    : `(${daysBetween(today, active.expiresAt) === 0 ? "hoy" : `en ${daysBetween(today, active.expiresAt)} días`})`}
                </strong>
              </p>
              {active.notes && <p className="mt-1 text-xs">{active.notes}</p>}
            </div>
            {canManageReservations && (
              <div className="flex flex-wrap gap-2">
                <ExtendDialog r={active} today={today} />
                <CancelDialog r={active} today={today} canNegotiate={canManageDeal} />
              </div>
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Al pasar la operación a escribanía / garantía la seña queda como “
            {RESERVATION_STATUS_LABELS.converted}”.
          </p>
        </div>
      )}

      {offers.length === 0 && !active ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          Sin ofertas registradas. Cargá la oferta del {clientWord} y las contraofertas del propietario para
          dejar rastro de la negociación.
        </p>
      ) : (
        <ol className="divide-y">
          {offers.map((o) => {
            const expired = isOfferExpired(o, today);
            return (
              <li key={o.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold">{price(o.amountMinor, o.currency)}</span>
                    <Badge tone="outline">{OFFER_PARTY_LABELS[o.party]}</Badge>
                    <Badge tone={expired ? "danger" : OFFER_TONE[o.status]}>
                      {expired ? "Vencida sin respuesta" : OFFER_STATUS_LABELS[o.status]}
                    </Badge>
                  </p>
                  {o.conditions && <p className="mt-0.5 text-sm">{o.conditions}</p>}
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {o.createdAtLabel}
                    {o.createdByName ? ` · cargó ${o.createdByName}` : ""}
                    {o.validUntil ? ` · válida hasta ${formatDay(o.validUntil)}` : ""}
                    {o.responseNote ? ` · “${o.responseNote}”` : ""}
                  </p>
                </div>
                {o.status === "pending" && canManageOffers && negotiating && (
                  <div className="flex flex-wrap gap-1.5">
                    <OfferActions o={o} />
                    <OfferDialog
                      title="Contraoferta"
                      dealId={dealId}
                      offerId={o.id}
                      defaultParty={otherParty(o.party)}
                      defaultCurrency={o.currency}
                      today={today}
                      trigger={
                        <Button size="sm" variant="secondary">
                          <ArrowRightLeft /> Contraofertar
                        </Button>
                      }
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {past.length > 0 && (
        <div className="border-t px-4 py-3">
          <p className="mb-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Reservas anteriores
          </p>
          <ul className="grid gap-1 text-sm">
            {past.map((r) => (
              <li key={r.id}>
                Seña {price(r.depositMinor, r.currency)} del {formatDay(r.receivedAt)} ·{" "}
                <span className="text-muted-foreground">{RESERVATION_STATUS_LABELS[r.status]}</span>
                {r.cancelReason ? ` · ${r.cancelReason}` : ""}
                {r.refundedAt ? ` · devuelta el ${formatDay(r.refundedAt)}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
