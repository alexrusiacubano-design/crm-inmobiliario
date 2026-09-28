"use client";

import { Check, CircleX, Plus, Trash2, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  COMMISSION_SIDE_LABELS,
  COMMISSION_STATUS_LABELS,
  OPEN_DEAL_STAGES,
  PARTICIPANT_ROLE_LABELS,
  PARTICIPANT_ROLES,
  dealStageLabel,
  sidesFor,
  type CommissionSide,
  type CommissionStatus,
  type DealStage,
  type ParticipantRole,
} from "@crm/shared/deals";
import type { PropertyOperation } from "@crm/shared/property";
import {
  changeDealStageAction,
  collectCommissionAction,
  setDealCommissionsAction,
  setDealParticipantsAction,
} from "@/app/(app)/commercial/deals/actions";
import { minorToInput, price } from "@/components/properties/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Badge, Card } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

const today = () => new Date().toISOString().slice(0, 10);

/** Etapas como pasos, con avanzar / retroceder / se cayó / cerrar. */
export function DealStageControls({
  dealId,
  stage,
  operation,
  canManage,
  canClose,
}: {
  dealId: string;
  stage: DealStage;
  operation: PropertyOperation;
  canManage: boolean;
  canClose: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dialog, setDialog] = useState<"fall" | "close" | null>(null);
  const [reason, setReason] = useState("");
  const [closedAt, setClosedAt] = useState(today());
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  const steps: DealStage[] = [...OPEN_DEAL_STAGES, "closed"];
  const idx = steps.indexOf(stage);
  const open = OPEN_DEAL_STAGES.includes(stage);
  const next = open ? steps[idx + 1] : undefined;
  const prev = open && idx > 0 ? steps[idx - 1] : undefined;

  const move = (to: DealStage, extra: Record<string, unknown> = {}) =>
    start(async () => {
      const r = await changeDealStageAction({ id: dealId, stage: to, ...extra });
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        return void toast.error(r.error);
      }
      toast.success(dealStageLabel(to, operation));
      setDialog(null);
      router.refresh();
    });

  return (
    <Card className="p-4">
      <ol className="grid grid-cols-5 gap-1" aria-label="Etapas">
        {steps.map((s, i) => {
          const done = stage === "closed" || (open && i < idx);
          const current = s === stage;
          return (
            <li key={s} className="min-w-0">
              <div
                className={cn(
                  "h-1.5 rounded-full",
                  done || current ? "bg-primary" : "bg-surface-muted",
                  stage === "fallen" && "bg-danger/40",
                )}
              />
              <p
                className={cn(
                  "mt-1.5 truncate text-[11px]",
                  current ? "font-semibold" : "text-muted-foreground",
                )}
              >
                {dealStageLabel(s, operation)}
              </p>
            </li>
          );
        })}
      </ol>
      {stage === "fallen" && (
        <p className="mt-3 text-sm text-danger">
          La operación se cayó.{" "}
          {canManage && (
            <button
              type="button"
              className="underline"
              disabled={pending}
              onClick={() => move("negotiation")}
            >
              Reabrir
            </button>
          )}
        </p>
      )}
      {open && canManage && (
        <div className="mt-4 flex flex-wrap gap-2">
          {next && next !== "closed" && (
            <Button size="sm" loading={pending} onClick={() => move(next)}>
              <Check /> Pasar a {dealStageLabel(next, operation).toLowerCase()}
            </Button>
          )}
          {canClose && (
            <Button
              size="sm"
              variant={next === "closed" ? "primary" : "secondary"}
              onClick={() => setDialog("close")}
            >
              <Check /> Cerrar operación
            </Button>
          )}
          {prev && (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => move(prev)}>
              <Undo2 /> Volver a {dealStageLabel(prev, operation).toLowerCase()}
            </Button>
          )}
          <Button size="sm" variant="ghost" className="text-danger" onClick={() => setDialog("fall")}>
            <CircleX /> Se cayó
          </Button>
        </div>
      )}

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent
          title={dialog === "fall" ? "La operación se cayó" : "Cerrar operación"}
          description={
            dialog === "fall"
              ? "La propiedad vuelve a estar disponible si no hay otra operación en curso. Los honorarios pendientes se anulan."
              : operation === "sale"
                ? "La propiedad pasa a Vendida y el lead del cliente a Cerrado."
                : "La propiedad pasa a Alquilada y el lead del cliente a Cerrado."
          }
        >
          <form
            className="grid gap-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (dialog === "fall") move("fallen", { fallenReason: reason });
              else move("closed", { closedAt });
            }}
          >
            {dialog === "fall" ? (
              <Field label="Motivo" htmlFor="df-r" error={errors.fallenReason}>
                <Textarea id="df-r" value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
            ) : (
              <Field label="Fecha de firma" htmlFor="dc-d" error={errors.closedAt}>
                <Input id="dc-d" type="date" value={closedAt} onChange={(e) => setClosedAt(e.target.value)} />
              </Field>
            )}
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setDialog(null)} disabled={pending}>
                Cancelar
              </Button>
              <Button type="submit" variant={dialog === "fall" ? "danger" : "primary"} loading={pending}>
                Confirmar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

interface CommissionView {
  id: string;
  side: CommissionSide;
  currency: "USD" | "UYU";
  amountMinor: bigint;
  status: CommissionStatus;
  dueDate: string | null;
  collectedAt: string | null;
  reference: string | null;
}

export function CommissionsCard({
  dealId,
  operation,
  defaultCurrency,
  items,
  canEdit,
  canCollect,
  locked,
}: {
  dealId: string;
  operation: PropertyOperation;
  defaultCurrency: "USD" | "UYU";
  items: CommissionView[];
  canEdit: boolean;
  canCollect: boolean;
  locked: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const sides = sidesFor(operation);
  const [lines, setLines] = useState(() =>
    sides.map((side) => {
      const c = items.find((x) => x.side === side);
      return {
        side,
        currency: c?.currency ?? defaultCurrency,
        amount: c ? minorToInput(c.amountMinor) : "",
        dueDate: c?.dueDate ?? "",
        collected: c?.status === "collected",
      };
    }),
  );
  const [collecting, setCollecting] = useState<CommissionView | null>(null);
  const [collectedAt, setCollectedAt] = useState(today());
  const [reference, setReference] = useState("");

  const total = (cur: "USD" | "UYU") =>
    items
      .filter((c) => c.currency === cur && c.status !== "cancelled")
      .reduce((a, c) => a + c.amountMinor, 0n);

  return (
    <Card>
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Honorarios</h2>
        {canEdit && !locked && !editing && (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Editar
          </Button>
        )}
      </div>
      {editing ? (
        <form
          className="grid gap-3 p-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await setDealCommissionsAction({
                dealId,
                lines: lines
                  .filter((l) => l.amount)
                  .map(({ side, currency, amount, dueDate }) => ({ side, currency, amount, dueDate })),
              });
              if (!r.ok) return void toast.error(r.error);
              toast.success("Honorarios guardados");
              setEditing(false);
              router.refresh();
            });
          }}
        >
          {lines.map((l, i) => (
            <div key={l.side} className="grid items-end gap-2 sm:grid-cols-[1fr_0.7fr_1fr_1fr]">
              <p className="pb-2 text-sm font-medium">{COMMISSION_SIDE_LABELS[l.side]}</p>
              <Field label="Moneda" htmlFor={`cm-c-${i}`}>
                <Select
                  id={`cm-c-${i}`}
                  value={l.currency}
                  disabled={l.collected}
                  onChange={(e) =>
                    setLines(
                      lines.map((x, j) =>
                        j === i ? { ...x, currency: e.target.value as "USD" | "UYU" } : x,
                      ),
                    )
                  }
                >
                  <option value="USD">U$S</option>
                  <option value="UYU">$</option>
                </Select>
              </Field>
              <Field label="Importe" htmlFor={`cm-a-${i}`}>
                <Input
                  id={`cm-a-${i}`}
                  inputMode="decimal"
                  value={l.amount}
                  disabled={l.collected}
                  onChange={(e) =>
                    setLines(lines.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))
                  }
                />
              </Field>
              <Field label="Cobro estimado" htmlFor={`cm-d-${i}`}>
                <Input
                  id={`cm-d-${i}`}
                  type="date"
                  value={l.dueDate}
                  disabled={l.collected}
                  onChange={(e) =>
                    setLines(lines.map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)))
                  }
                />
              </Field>
            </div>
          ))}
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setEditing(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button type="submit" size="sm" loading={pending}>
              Guardar
            </Button>
          </DialogFooter>
        </form>
      ) : items.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">Sin honorarios cargados.</p>
      ) : (
        <>
          <ul className="divide-y text-sm">
            {items.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{COMMISSION_SIDE_LABELS[c.side]}</span>
                  <span className="block text-xs text-muted-foreground">
                    {c.status === "collected"
                      ? `Cobrado el ${c.collectedAt?.split("-").reverse().join("/")}${c.reference ? ` · ${c.reference}` : ""}`
                      : c.dueDate
                        ? `Cobro estimado ${c.dueDate.split("-").reverse().join("/")}`
                        : "Sin fecha estimada"}
                  </span>
                </span>
                <span className="font-semibold tabular">{price(c.amountMinor, c.currency)}</span>
                <Badge
                  tone={
                    c.status === "collected" ? "success" : c.status === "cancelled" ? "neutral" : "warning"
                  }
                >
                  {COMMISSION_STATUS_LABELS[c.status]}
                </Badge>
                {canCollect && c.status === "pending" && (
                  <Button size="sm" variant="secondary" onClick={() => setCollecting(c)}>
                    Registrar cobro
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <p className="border-t px-4 py-2 text-right text-xs text-muted-foreground">
            Total:{" "}
            {[
              total("USD") > 0n && price(total("USD"), "USD"),
              total("UYU") > 0n && price(total("UYU"), "UYU"),
            ]
              .filter(Boolean)
              .join(" + ")}
          </p>
        </>
      )}
      <Dialog open={!!collecting} onOpenChange={(o) => !o && setCollecting(null)}>
        <DialogContent
          title="Registrar cobro"
          description={
            collecting
              ? `${COMMISSION_SIDE_LABELS[collecting.side]} · ${price(collecting.amountMinor, collecting.currency)}`
              : ""
          }
        >
          <form
            className="grid gap-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (!collecting) return;
              start(async () => {
                const r = await collectCommissionAction({
                  commissionId: collecting.id,
                  collectedAt,
                  reference,
                });
                if (!r.ok) return void toast.error(r.error);
                toast.success("Cobro registrado");
                setCollecting(null);
                router.refresh();
              });
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Fecha" htmlFor="cc-d">
                <Input
                  id="cc-d"
                  type="date"
                  value={collectedAt}
                  onChange={(e) => setCollectedAt(e.target.value)}
                />
              </Field>
              <Field label="Recibo o referencia" htmlFor="cc-r">
                <Input id="cc-r" value={reference} onChange={(e) => setReference(e.target.value)} />
              </Field>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setCollecting(null)}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button type="submit" loading={pending}>
                Registrar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export function ParticipantsCard({
  dealId,
  items,
  users,
  canEdit,
}: {
  dealId: string;
  items: {
    userId: string;
    name: string;
    role: ParticipantRole;
    shareBasisPoints: number;
    agentRateBasisPoints: number | null;
  }[];
  users: { userId: string; name: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [rows, setRows] = useState(() =>
    items.map((p) => ({
      userId: p.userId,
      role: p.role,
      share: String(p.shareBasisPoints / 100).replace(".", ","),
    })),
  );
  const [error, setError] = useState<string | null>(null);

  return (
    <Card>
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Reparto entre agentes</h2>
        {canEdit && !editing && (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Editar
          </Button>
        )}
      </div>
      {editing ? (
        <form
          className="grid gap-3 p-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await setDealParticipantsAction({ dealId, participants: rows });
              if (!r.ok) {
                setError(r.fieldErrors?.participants?.[0] ?? r.error);
                return void toast.error(r.error);
              }
              toast.success("Reparto guardado");
              setEditing(false);
              setError(null);
              router.refresh();
            });
          }}
        >
          {rows.map((r, i) => (
            <div key={i} className="grid items-end gap-2 sm:grid-cols-[1.4fr_1fr_0.6fr_auto]">
              <Field label="Agente" htmlFor={`dp-u-${i}`}>
                <Select
                  id={`dp-u-${i}`}
                  value={r.userId}
                  onChange={(e) =>
                    setRows(rows.map((x, j) => (j === i ? { ...x, userId: e.target.value } : x)))
                  }
                >
                  {users.map((u) => (
                    <option key={u.userId} value={u.userId}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Rol" htmlFor={`dp-r-${i}`}>
                <Select
                  id={`dp-r-${i}`}
                  value={r.role}
                  onChange={(e) =>
                    setRows(
                      rows.map((x, j) => (j === i ? { ...x, role: e.target.value as ParticipantRole } : x)),
                    )
                  }
                >
                  {PARTICIPANT_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {PARTICIPANT_ROLE_LABELS[role]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="%" htmlFor={`dp-s-${i}`}>
                <Input
                  id={`dp-s-${i}`}
                  inputMode="decimal"
                  value={r.share}
                  onChange={(e) =>
                    setRows(rows.map((x, j) => (j === i ? { ...x, share: e.target.value } : x)))
                  }
                />
              </Field>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Quitar"
                disabled={rows.length === 1}
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex flex-wrap justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                setRows([...rows, { userId: users[0]?.userId ?? "", role: "collaborator", share: "" }])
              }
            >
              <Plus /> Agregar
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setEditing(false)}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button type="submit" size="sm" loading={pending}>
                Guardar
              </Button>
            </div>
          </div>
        </form>
      ) : (
        <ul className="divide-y text-sm">
          {items.map((p) => (
            <li key={p.userId} className="flex items-center justify-between gap-3 px-4 py-3">
              <span>
                <span className="font-medium">{p.name}</span>
                <span className="block text-xs text-muted-foreground">{PARTICIPANT_ROLE_LABELS[p.role]}</span>
              </span>
              <span className="text-right tabular">
                {String(p.shareBasisPoints / 100).replace(".", ",")} %
                {p.agentRateBasisPoints !== null && (
                  <span className="block text-xs text-muted-foreground">
                    cobra el {String(p.agentRateBasisPoints / 100).replace(".", ",")} %
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
