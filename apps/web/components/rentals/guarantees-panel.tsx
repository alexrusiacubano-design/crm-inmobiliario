"use client";

import { Check, Pencil, Plus, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  canTransitionGuarantee,
  DEPOSIT_PLACE_LABELS,
  DEPOSIT_PLACES,
  GUARANTEE_ALERT_LABELS,
  GUARANTEE_STATUS_LABELS,
  GUARANTEE_TYPE_LABELS,
  GUARANTEE_TYPES,
  type DepositPlace,
  type GuaranteeAlert,
  type GuaranteeRequirement,
  type GuaranteeStatus,
  type GuaranteeType,
} from "@crm/shared/guarantees";
import {
  changeGuaranteeStatusAction,
  createGuaranteeAction,
  setGuaranteeRequirementAction,
  updateGuaranteeAction,
} from "@/app/(app)/rentals/actions";
import { Picker } from "@/components/deals/new-deal-dialog";
import { formatDay, minorToInput, price } from "@/components/properties/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { Badge, Card } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

type Currency = "UYU" | "USD";
interface Link {
  id: string;
  label: string;
}

export interface GuaranteeView {
  id: string;
  type: GuaranteeType;
  status: GuaranteeStatus;
  provider: string | null;
  reference: string | null;
  currency: Currency;
  coverageMinor: string | null;
  requestedAt: string;
  validFrom: string | null;
  validUntil: string | null;
  depositPlace: DepositPlace | null;
  guarantorContactId: string | null;
  guarantorName: string | null;
  requirements: GuaranteeRequirement[];
  notes: string | null;
  statusNote: string | null;
  contractId: string | null;
  contractCode: string | null;
  alerts: GuaranteeAlert[];
  shortOfContract: boolean;
}

const STATUS_TONE: Record<GuaranteeStatus, "warning" | "primary" | "danger" | "success" | "neutral"> = {
  in_process: "warning",
  approved: "primary",
  rejected: "danger",
  active: "success",
  expired: "danger",
  released: "neutral",
};

/** Acciones de cada estado (las que el trámite permite). */
const NEXT: Partial<Record<GuaranteeStatus, { to: GuaranteeStatus; label: string; needsNote?: boolean }[]>> =
  {
    in_process: [
      { to: "approved", label: "Aprobada" },
      { to: "rejected", label: "Rechazada", needsNote: true },
    ],
    approved: [
      { to: "active", label: "Vigente" },
      { to: "rejected", label: "Rechazada", needsNote: true },
    ],
    rejected: [{ to: "in_process", label: "Volver a tramitar" }],
    active: [
      { to: "expired", label: "Vencida" },
      { to: "released", label: "Liberar" },
    ],
    expired: [
      { to: "active", label: "Renovada (vigente)" },
      { to: "released", label: "Liberar" },
    ],
  };

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const run = (
    fn: () => Promise<{ ok: boolean; error?: string; fieldErrors?: Record<string, string[]> }>,
    ok: string | null,
    after?: () => void,
  ) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        return void toast.error(r.error);
      }
      setErrors({});
      if (ok) toast.success(ok);
      after?.();
      router.refresh();
    });
  return { pending, errors, run };
}

export function GuaranteeDialog({
  existing,
  tenant,
  contractId,
  dealId,
  trigger,
}: {
  existing?: GuaranteeView;
  /** Inquilino fijo (desde contrato u operación); si falta se elige. */
  tenant?: Link;
  contractId?: string | null;
  dealId?: string | null;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState<Link | null>(tenant ?? null);
  const [type, setType] = useState<GuaranteeType>(existing?.type ?? "insurance");
  const [provider, setProvider] = useState(existing?.provider ?? "");
  const [reference, setReference] = useState(existing?.reference ?? "");
  const [currency, setCurrency] = useState<Currency>(existing?.currency ?? "UYU");
  const [coverage, setCoverage] = useState(minorToInput(existing?.coverageMinor ?? null));
  const [validFrom, setValidFrom] = useState(existing?.validFrom ?? "");
  const [validUntil, setValidUntil] = useState(existing?.validUntil ?? "");
  const [place, setPlace] = useState<DepositPlace>(existing?.depositPlace ?? "bhu");
  const [guarantor, setGuarantor] = useState<Link | null>(
    existing?.guarantorContactId
      ? { id: existing.guarantorContactId, label: existing.guarantorName ?? "" }
      : null,
  );
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const { pending, errors, run } = useRun();
  const lockType = existing && existing.status !== "in_process";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <span onClick={() => setOpen(true)}>
        {trigger ?? (
          <Button size="sm" variant="secondary">
            <Plus /> Nueva garantía
          </Button>
        )}
      </span>
      <DialogContent
        title={existing ? "Editar garantía" : "Nueva garantía"}
        description={existing ? undefined : "Arranca en trámite con la lista de requisitos del tipo elegido."}
        className="max-w-2xl"
      >
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            const common = {
              type,
              provider,
              reference,
              currency,
              coverage,
              validFrom,
              validUntil,
              depositPlace: type === "deposit" ? place : null,
              guarantorContactId:
                type === "property_guarantor" || type === "other" ? (guarantor?.id ?? null) : null,
              notes,
            };
            run(
              () =>
                existing
                  ? updateGuaranteeAction({ id: existing.id, ...common })
                  : createGuaranteeAction({
                      tenantContactId: who?.id ?? "",
                      contractId: contractId ?? null,
                      dealId: dealId ?? null,
                      ...common,
                    }),
              existing ? "Garantía actualizada" : "Garantía registrada",
              () => setOpen(false),
            );
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {!existing &&
              (tenant ? (
                <Field label="Inquilino">
                  <p className="flex h-9 items-center rounded-md border bg-surface-muted px-3 text-sm">
                    {tenant.label}
                  </p>
                </Field>
              ) : (
                <Picker
                  kind="contact"
                  label="Inquilino"
                  value={who}
                  onChange={setWho}
                  error={errors.tenantContactId}
                />
              ))}
            <Field label="Tipo" htmlFor="gu-t" hint={lockType ? "No se cambia fuera del trámite" : undefined}>
              <Select
                id="gu-t"
                value={type}
                disabled={lockType}
                onChange={(e) => setType(e.target.value as GuaranteeType)}
              >
                {GUARANTEE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {GUARANTEE_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={type === "insurance" ? "Aseguradora" : "Organismo / entidad"} htmlFor="gu-p">
              <Input id="gu-p" value={provider} onChange={(e) => setProvider(e.target.value)} />
            </Field>
            <Field label="N.º de póliza, certificado o solicitud" htmlFor="gu-r">
              <Input id="gu-r" value={reference} onChange={(e) => setReference(e.target.value)} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Moneda" htmlFor="gu-c">
              <Select id="gu-c" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
                <option value="UYU">$ (UYU)</option>
                <option value="USD">U$S</option>
              </Select>
            </Field>
            <Field
              label={type === "deposit" ? "Monto depositado" : "Cobertura"}
              htmlFor="gu-cv"
              error={errors.coverage}
            >
              <Input
                id="gu-cv"
                inputMode="decimal"
                value={coverage}
                onChange={(e) => setCoverage(e.target.value)}
              />
            </Field>
            <Field label="Vigente desde" htmlFor="gu-f">
              <Input id="gu-f" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
            </Field>
            <Field label="Vence" htmlFor="gu-u" error={errors.validUntil}>
              <Input
                id="gu-u"
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
              />
            </Field>
          </div>
          {type === "deposit" && (
            <Field label="Depositado en" htmlFor="gu-pl">
              <Select id="gu-pl" value={place} onChange={(e) => setPlace(e.target.value as DepositPlace)}>
                {DEPOSIT_PLACES.map((p) => (
                  <option key={p} value={p}>
                    {DEPOSIT_PLACE_LABELS[p]}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {(type === "property_guarantor" || type === "other") && (
            <Picker
              kind="contact"
              label="Fiador"
              value={guarantor}
              onChange={setGuarantor}
              error={errors.guarantorContactId}
            />
          )}
          <Field label="Notas" htmlFor="gu-n">
            <Textarea id="gu-n" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function GuaranteeCard({
  g,
  canManage,
  contractId,
}: {
  g: GuaranteeView;
  canManage: boolean;
  contractId?: string | null;
}) {
  const { pending, run } = useRun();
  const [newReq, setNewReq] = useState("");
  const done = g.requirements.filter((r) => r.done).length;
  const editableReqs =
    canManage && (g.status === "in_process" || g.status === "approved" || g.status === "rejected");

  const move = (to: GuaranteeStatus, needsNote?: boolean) => {
    let note: string | null = null;
    if (needsNote) {
      note = window.prompt("Motivo");
      if (!note) return;
    }
    run(
      () =>
        changeGuaranteeStatusAction({
          id: g.id,
          status: to,
          note,
          contractId: g.contractId ?? contractId ?? null,
        }),
      GUARANTEE_STATUS_LABELS[to],
    );
  };

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="font-semibold">{GUARANTEE_TYPE_LABELS[g.type]}</span>
            <Badge tone={STATUS_TONE[g.status]}>{GUARANTEE_STATUS_LABELS[g.status]}</Badge>
            {g.alerts.map((a) => (
              <Badge key={a} tone={a === "expired" ? "danger" : "warning"}>
                {GUARANTEE_ALERT_LABELS[a]}
              </Badge>
            ))}
            {g.shortOfContract && <Badge tone="warning">No cubre hasta el fin del contrato</Badge>}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {[
              g.provider,
              g.reference ? `N.º ${g.reference}` : null,
              g.coverageMinor
                ? `${g.type === "deposit" ? "Monto" : "Cobertura"} ${price(g.coverageMinor, g.currency)}`
                : null,
              g.depositPlace ? `en ${DEPOSIT_PLACE_LABELS[g.depositPlace]}` : null,
              g.guarantorName ? `Fiador: ${g.guarantorName}` : null,
              g.validUntil
                ? `${formatDay(g.validFrom)} → ${formatDay(g.validUntil)}`
                : `Pedida el ${formatDay(g.requestedAt)}`,
              g.contractCode && !contractId ? `Contrato ${g.contractCode}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {g.statusNote && <p className="mt-0.5 text-xs">“{g.statusNote}”</p>}
          {g.notes && <p className="mt-0.5 text-xs text-muted-foreground">{g.notes}</p>}
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-1.5">
            {(NEXT[g.status] ?? [])
              .filter((n) => canTransitionGuarantee(g.status, n.to))
              .map((n) => (
                <Button
                  key={n.to}
                  size="sm"
                  variant={n.to === "active" || n.to === "approved" ? "primary" : "ghost"}
                  disabled={pending || (n.to === "active" && done < g.requirements.length)}
                  title={n.to === "active" && done < g.requirements.length ? "Faltan requisitos" : undefined}
                  onClick={() => move(n.to, n.needsNote)}
                >
                  {n.label}
                </Button>
              ))}
            {g.status !== "released" && (
              <GuaranteeDialog
                existing={g}
                trigger={
                  <Button size="icon-sm" variant="ghost" aria-label="Editar">
                    <Pencil />
                  </Button>
                }
              />
            )}
          </div>
        )}
      </div>
      {g.requirements.length > 0 &&
        (g.status === "in_process" || g.status === "approved" || g.status === "rejected") && (
          <div className="mt-2 rounded-md bg-surface-muted/60 p-2">
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Requisitos {done}/{g.requirements.length}
            </p>
            <ul className="grid gap-1 sm:grid-cols-2">
              {g.requirements.map((r, i) => (
                <li key={`${r.label}-${i}`}>
                  <label
                    className={cn(
                      "flex items-center gap-2 text-sm",
                      r.done && "text-muted-foreground line-through",
                    )}
                  >
                    <Checkbox
                      checked={r.done}
                      disabled={!editableReqs || pending}
                      onChange={(e) =>
                        run(
                          () => setGuaranteeRequirementAction({ id: g.id, index: i, done: e.target.checked }),
                          null,
                        )
                      }
                    />
                    {r.label}
                  </label>
                </li>
              ))}
            </ul>
            {editableReqs && (
              <form
                className="mt-2 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newReq.trim()) return;
                  run(
                    () => setGuaranteeRequirementAction({ id: g.id, index: 0, done: false, label: newReq }),
                    "Requisito agregado",
                    () => setNewReq(""),
                  );
                }}
              >
                <Input
                  className="h-8"
                  placeholder="Agregar requisito…"
                  value={newReq}
                  onChange={(e) => setNewReq(e.target.value)}
                />
                <Button size="sm" variant="secondary" type="submit" disabled={pending}>
                  <Check />
                </Button>
              </form>
            )}
          </div>
        )}
    </li>
  );
}

/** Garantías de un contrato u operación de alquiler. */
export function GuaranteesPanel({
  items,
  canManage,
  tenant,
  contractId,
  dealId,
  title = "Garantías",
}: {
  items: GuaranteeView[];
  canManage: boolean;
  tenant: Link;
  contractId?: string | null;
  dealId?: string | null;
  title?: string;
}) {
  return (
    <Card>
      <div className="flex items-center justify-between border-b px-4 py-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <ShieldCheck className="size-4 text-muted-foreground" /> {title}
        </h2>
        {canManage && <GuaranteeDialog tenant={tenant} contractId={contractId} dealId={dealId} />}
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-5 text-sm text-muted-foreground">
          Sin garantías cargadas. Registrá la garantía en trámite para seguir los requisitos y su vencimiento.
        </p>
      ) : (
        <ul className="divide-y">
          {items.map((g) => (
            <GuaranteeCard key={g.id} g={g} canManage={canManage} contractId={contractId} />
          ))}
        </ul>
      )}
    </Card>
  );
}
