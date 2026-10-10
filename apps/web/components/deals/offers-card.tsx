"use client";

import { ArrowRightLeft, CalendarPlus, Check, HandCoins, Pencil, Plus, Undo2, X } from "lucide-react";
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
  type ReservationNotary,
} from "@crm/shared/offers";
import {
  cancelReservationAction,
  createOfferAction,
  createReservationAction,
  extendReservationAction,
  respondOfferAction,
  updateReservationAction,
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
  signingDate: string | null;
  boletoSignedAt: string | null;
  boletoExpiresAt: string | null;
  shared: boolean;
  sharedWith: string | null;
  buyerNotary: ReservationNotary | null;
  sellerNotary: ReservationNotary | null;
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

const minorText = (v: string) => {
  const n = BigInt(v || "0");
  if (n === 0n) return "";
  const c = n % 100n;
  return c === 0n ? (n / 100n).toString() : `${n / 100n},${c.toString().padStart(2, "0")}`;
};

function NotaryFields({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ReservationNotary;
  onChange: (v: ReservationNotary) => void;
}) {
  return (
    <fieldset className="grid gap-2 rounded-md border p-3">
      <legend className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </legend>
      <Input
        placeholder="Nombre y apellido"
        aria-label={`${label}: nombre`}
        value={value.name}
        onChange={(e) => onChange({ ...value, name: e.target.value })}
      />
      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          placeholder="Teléfono"
          inputMode="tel"
          aria-label={`${label}: teléfono`}
          value={value.phone ?? ""}
          onChange={(e) => onChange({ ...value, phone: e.target.value })}
        />
        <Input
          placeholder="Email"
          type="email"
          aria-label={`${label}: email`}
          value={value.email ?? ""}
          onChange={(e) => onChange({ ...value, email: e.target.value })}
        />
      </div>
    </fieldset>
  );
}

function ReservationDialog({
  dealId,
  defaultCurrency,
  today,
  existing,
}: {
  dealId: string;
  defaultCurrency: Currency;
  today: string;
  /** Si viene, se edita esa reserva. */
  existing?: ReservationView;
}) {
  const blank = (): ReservationNotary => ({ name: "", phone: "", email: "" });
  const init = () => ({
    currency: existing?.currency ?? defaultCurrency,
    withDeposit: existing ? BigInt(existing.depositMinor) > 0n : true,
    deposit: existing ? minorText(existing.depositMinor) : "",
    receivedAt: existing?.receivedAt ?? today,
    expiresAt: existing?.expiresAt ?? addDays(today, 15),
    holder: existing?.holder ?? ("agency" as DepositHolder),
    receipt: existing?.receiptNumber ?? "",
    notes: existing?.notes ?? "",
    signingDate: existing?.signingDate ?? "",
    boletoSignedAt: existing?.boletoSignedAt ?? "",
    boletoExpiresAt: existing?.boletoExpiresAt ?? "",
    shared: existing?.shared ?? false,
    sharedWith: existing?.sharedWith ?? "",
    buyerNotary: existing?.buyerNotary ?? blank(),
    sellerNotary: existing?.sellerNotary ?? blank(),
  });
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(init);
  const set = <K extends keyof ReturnType<typeof init>>(k: K, value: ReturnType<typeof init>[K]) =>
    setV((p) => ({ ...p, [k]: value }));
  const { pending, errors, run, setErrors } = useRun();
  const editing = Boolean(existing);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setV(init());
          setErrors({});
        }
        setOpen(o);
      }}
    >
      {editing ? (
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          <Pencil /> Editar reserva
        </Button>
      ) : (
        <Button size="sm" onClick={() => setOpen(true)}>
          <HandCoins /> Registrar reserva
        </Button>
      )}
      <DialogContent
        title={editing ? "Editar la reserva" : "Registrar reserva"}
        description={
          editing
            ? "Queda registrado qué cambiaste."
            : "La operación y la propiedad pasan a Reservada. Se puede reservar con o sin seña."
        }
        className="max-w-2xl"
      >
        <form
          className="grid max-h-[70vh] gap-4 overflow-y-auto pr-1"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            const payload = {
              currency: v.currency,
              deposit: v.withDeposit ? v.deposit : "",
              receivedAt: v.receivedAt,
              expiresAt: v.expiresAt,
              holder: v.holder,
              receiptNumber: v.withDeposit ? v.receipt : "",
              notes: v.notes,
              signingDate: v.signingDate,
              boletoSignedAt: v.boletoSignedAt,
              boletoExpiresAt: v.boletoExpiresAt,
              shared: v.shared,
              sharedWith: v.sharedWith,
              buyerNotary: v.buyerNotary,
              sellerNotary: v.sellerNotary,
            };
            run(
              () =>
                existing
                  ? updateReservationAction({ reservationId: existing.id, ...payload })
                  : createReservationAction({ dealId, ...payload }),
              editing ? "Reserva actualizada" : "Reserva registrada",
              () => setOpen(false),
            );
          }}
        >
          <section className="grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">Seña</h3>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={!v.withDeposit} onChange={(e) => set("withDeposit", !e.target.checked)} />
                Reserva sin seña
              </label>
            </div>
            {v.withDeposit ? (
              <div className="grid gap-3 sm:grid-cols-4">
                <Field label="Moneda" htmlFor="rs-c">
                  <Select
                    id="rs-c"
                    value={v.currency}
                    onChange={(e) => set("currency", e.target.value as Currency)}
                  >
                    <option value="USD">U$S</option>
                    <option value="UYU">$ (UYU)</option>
                  </Select>
                </Field>
                <Field label="Monto" htmlFor="rs-d" error={errors.deposit}>
                  <Input
                    id="rs-d"
                    inputMode="decimal"
                    value={v.deposit}
                    onChange={(e) => set("deposit", e.target.value)}
                  />
                </Field>
                <Field label="La tiene" htmlFor="rs-h">
                  <Select
                    id="rs-h"
                    value={v.holder}
                    onChange={(e) => set("holder", e.target.value as DepositHolder)}
                  >
                    {DEPOSIT_HOLDERS.map((h) => (
                      <option key={h} value={h}>
                        {DEPOSIT_HOLDER_LABELS[h]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="N.º de recibo" htmlFor="rs-n">
                  <Input id="rs-n" value={v.receipt} onChange={(e) => set("receipt", e.target.value)} />
                </Field>
              </div>
            ) : (
              <p className="rounded-md bg-surface-muted px-3 py-2 text-sm text-muted-foreground">
                La propiedad queda reservada para el cliente sin cobrar seña.
              </p>
            )}
          </section>

          <section className="grid gap-3 border-t pt-4">
            <h3 className="text-sm font-semibold">Plazos y firma</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={v.withDeposit ? "Seña cobrada el" : "Reservada el"}
                htmlFor="rs-r"
                error={errors.receivedAt}
              >
                <Input
                  id="rs-r"
                  type="date"
                  value={v.receivedAt}
                  onChange={(e) => set("receivedAt", e.target.value)}
                />
              </Field>
              <Field
                label="La reserva vence el"
                htmlFor="rs-e"
                error={errors.expiresAt}
                hint="Plazo para firmar boleto o contrato"
              >
                <Input
                  id="rs-e"
                  type="date"
                  value={v.expiresAt}
                  onChange={(e) => set("expiresAt", e.target.value)}
                />
              </Field>
              <Field label="Firma pactada" htmlFor="rs-sign" hint="Cuándo se firma (y se cobra)">
                <Input
                  id="rs-sign"
                  type="date"
                  value={v.signingDate}
                  onChange={(e) => set("signingDate", e.target.value)}
                />
              </Field>
              <div />
              <Field label="Boleto firmado el" htmlFor="rs-bs" hint="Vacío si todavía es solo una reserva">
                <Input
                  id="rs-bs"
                  type="date"
                  value={v.boletoSignedAt}
                  onChange={(e) => set("boletoSignedAt", e.target.value)}
                />
              </Field>
              <Field label="Boleto vence el" htmlFor="rs-be" error={errors.boletoExpiresAt}>
                <Input
                  id="rs-be"
                  type="date"
                  value={v.boletoExpiresAt}
                  onChange={(e) => set("boletoExpiresAt", e.target.value)}
                />
              </Field>
            </div>
          </section>

          <section className="grid gap-3 border-t pt-4">
            <label className="flex items-center gap-2 text-sm font-semibold">
              <Checkbox checked={v.shared} onChange={(e) => set("shared", e.target.checked)} />
              Operación compartida
            </label>
            {v.shared && (
              <Field
                label="Compartida con"
                htmlFor="rs-sw"
                hint="Inmobiliaria o colega con quien se comparten honorarios"
              >
                <Input id="rs-sw" value={v.sharedWith} onChange={(e) => set("sharedWith", e.target.value)} />
              </Field>
            )}
            <Field label="Comentarios / condiciones del negocio" htmlFor="rs-notes">
              <Textarea
                id="rs-notes"
                rows={3}
                value={v.notes}
                onChange={(e) => set("notes", e.target.value)}
              />
            </Field>
          </section>

          <section className="grid gap-3 border-t pt-4">
            <h3 className="text-sm font-semibold">Escribanos</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <NotaryFields
                label="Escribano comprador"
                value={v.buyerNotary}
                onChange={(n) => set("buyerNotary", n)}
              />
              <NotaryFields
                label="Escribano vendedor"
                value={v.sellerNotary}
                onChange={(n) => set("sellerNotary", n)}
              />
            </div>
          </section>

          <p className="text-xs text-muted-foreground">
            Los honorarios del vendedor y del comprador se cargan en la sección Honorarios de la operación.
          </p>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              {editing ? "Guardar cambios" : "Registrar reserva"}
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
        description={
          BigInt(r.depositMinor) > 0n
            ? `Seña de ${price(r.depositMinor, r.currency)}. Indicá qué pasa con la seña y con la operación.`
            : "Reserva sin seña. Indicá el motivo y qué pasa con la operación."
        }
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
                Reserva vigente ·{" "}
                {BigInt(active.depositMinor) > 0n
                  ? `seña ${price(active.depositMinor, active.currency)}`
                  : "sin seña"}
              </p>
              <p className="text-xs text-muted-foreground">
                {BigInt(active.depositMinor) > 0n ? (
                  <>
                    Cobrada el {formatDay(active.receivedAt)} · la tiene{" "}
                    {DEPOSIT_HOLDER_LABELS[active.holder].toLowerCase()}
                    {active.receiptNumber ? ` · recibo ${active.receiptNumber}` : ""}
                  </>
                ) : (
                  <>Reservada el {formatDay(active.receivedAt)}</>
                )}{" "}
                · vence el {formatDay(active.expiresAt)}{" "}
                <strong>
                  {active.expiresAt < today
                    ? "(vencida)"
                    : `(${daysBetween(today, active.expiresAt) === 0 ? "hoy" : `en ${daysBetween(today, active.expiresAt)} días`})`}
                </strong>
              </p>
              {(active.signingDate || active.boletoSignedAt || active.boletoExpiresAt) && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {[
                    active.signingDate ? `Firma pactada ${formatDay(active.signingDate)}` : null,
                    active.boletoSignedAt ? `Boleto firmado ${formatDay(active.boletoSignedAt)}` : null,
                    active.boletoExpiresAt ? `boleto vence ${formatDay(active.boletoExpiresAt)}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
              {active.shared && (
                <p className="mt-1 text-xs">
                  Compartida{active.sharedWith ? ` con ${active.sharedWith}` : ""}
                </p>
              )}
              {(active.buyerNotary || active.sellerNotary) && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {[
                    active.buyerNotary
                      ? `Esc. comprador: ${[active.buyerNotary.name, active.buyerNotary.phone].filter(Boolean).join(" · ")}`
                      : null,
                    active.sellerNotary
                      ? `Esc. vendedor: ${[active.sellerNotary.name, active.sellerNotary.phone].filter(Boolean).join(" · ")}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" — ")}
                </p>
              )}
              {active.notes && <p className="mt-1 text-xs">{active.notes}</p>}
            </div>
            {canManageReservations && (
              <div className="flex flex-wrap gap-2">
                <ReservationDialog
                  dealId={dealId}
                  defaultCurrency={defaultCurrency}
                  today={today}
                  existing={active}
                />
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
                {BigInt(r.depositMinor) > 0n ? `Seña ${price(r.depositMinor, r.currency)}` : "Sin seña"} del{" "}
                {formatDay(r.receivedAt)} ·{" "}
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
