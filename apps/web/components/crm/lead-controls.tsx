"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  canTransitionLead,
  LEAD_LOST_REASON_LABELS,
  LEAD_LOST_REASONS,
  LEAD_STATUS_LABELS,
  LEAD_STATUSES,
  OPEN_LEAD_STATUSES,
  type LeadLostReason,
  type LeadStatus,
} from "@crm/shared/crm";
import { assignLeadAction, changeLeadStatusAction } from "@/app/(app)/crm/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/form";
import { cn } from "@/lib/utils";

const FUNNEL: LeadStatus[] = ["new", "contacted", "qualified", "visit", "offer", "reservation", "won"];

export function LeadStepper({ status }: { status: LeadStatus }) {
  const current = FUNNEL.indexOf(status);
  return (
    <ol
      className="flex w-full overflow-x-auto rounded-md border bg-surface text-xs"
      aria-label="Etapa del embudo"
    >
      {FUNNEL.map((s, i) => {
        const done = status !== "lost" && i < current;
        const active = s === status;
        return (
          <li
            key={s}
            aria-current={active ? "step" : undefined}
            className={cn(
              "flex min-w-24 flex-1 items-center justify-center gap-1 border-r px-2 py-2 last:border-r-0",
              active && "bg-primary text-primary-foreground font-medium",
              done && "bg-primary-soft text-primary",
              !active && !done && "text-muted-foreground",
            )}
          >
            {done && <Check className="size-3" aria-hidden />}
            {LEAD_STATUS_LABELS[s]}
          </li>
        );
      })}
      {status === "lost" && (
        <li className="flex items-center bg-surface-muted px-3 font-medium text-danger">Perdido</li>
      )}
    </ol>
  );
}

export function LeadStatusControl({ leadId, status }: { leadId: string; status: LeadStatus }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [lostOpen, setLostOpen] = useState(false);
  const [reason, setReason] = useState<LeadLostReason>("no_response");
  const [note, setNote] = useState("");
  const options = LEAD_STATUSES.filter((s) => canTransitionLead(status, s));

  const move = (to: LeadStatus, extra: { lostReason?: LeadLostReason; note?: string } = {}) =>
    startTransition(async () => {
      const r = await changeLeadStatusAction({ leadId, status: to, ...extra });
      if (!r.ok) return void toast.error(r.error);
      toast.success(`Etapa: ${LEAD_STATUS_LABELS[to]}`);
      setLostOpen(false);
      router.refresh();
    });

  if (options.length === 0) return null;
  const nextStep = OPEN_LEAD_STATUSES.includes(status) ? FUNNEL[FUNNEL.indexOf(status) + 1] : undefined;

  return (
    <div className="flex flex-wrap gap-2">
      {nextStep && canTransitionLead(status, nextStep) && (
        <Button size="sm" onClick={() => move(nextStep)} loading={pending}>
          Pasar a {LEAD_STATUS_LABELS[nextStep]}
        </Button>
      )}
      <Select
        aria-label="Cambiar etapa"
        value=""
        disabled={pending}
        onChange={(e) => {
          const to = e.target.value as LeadStatus;
          if (!to) return;
          if (to === "lost") setLostOpen(true);
          else move(to);
        }}
        className="h-8 w-44 text-sm"
      >
        <option value="">Otra etapa…</option>
        {options.map((s) => (
          <option key={s} value={s}>
            {s === "lost" ? "Marcar como perdido" : LEAD_STATUS_LABELS[s]}
          </option>
        ))}
      </Select>
      <Dialog open={lostOpen} onOpenChange={setLostOpen}>
        <DialogContent
          title="Marcar como perdido"
          description="El motivo alimenta los reportes de conversión."
        >
          <div className="grid gap-4">
            <Field label="Motivo" htmlFor="lost-reason">
              <Select
                id="lost-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value as LeadLostReason)}
              >
                {LEAD_LOST_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {LEAD_LOST_REASON_LABELS[r]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Comentario (opcional)" htmlFor="lost-note">
              <Textarea id="lost-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setLostOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button
                variant="danger"
                loading={pending}
                onClick={() => move("lost", { lostReason: reason, note })}
              >
                Marcar como perdido
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function LeadAssignControl({
  leadId,
  assignedUserId,
  assignees,
}: {
  leadId: string;
  assignedUserId: string | null;
  assignees: { userId: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Select
      aria-label="Responsable"
      value={assignedUserId ?? ""}
      disabled={pending}
      className="h-8 text-sm"
      onChange={(e) =>
        startTransition(async () => {
          const r = await assignLeadAction({ leadId, assignedUserId: e.target.value });
          if (!r.ok) return void toast.error(r.error);
          toast.success("Responsable actualizado");
          router.refresh();
        })
      }
    >
      {!assignedUserId && <option value="">Sin responsable</option>}
      {assignees.map((a) => (
        <option key={a.userId} value={a.userId}>
          {a.name}
        </option>
      ))}
    </Select>
  );
}
