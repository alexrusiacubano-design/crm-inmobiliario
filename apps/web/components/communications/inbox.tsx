"use client";

import { Check, Inbox, Plus, UserPlus, UserRoundCheck, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  INQUIRY_CHANNEL_LABELS,
  INQUIRY_CHANNELS,
  INQUIRY_STATUS_LABELS,
  type InquiryChannel,
  type InquiryStatus,
} from "@crm/shared/communications";
import {
  actOnInquiryAction,
  convertInquiryAction,
  createInquiryAction,
} from "@/app/(app)/communications/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Badge, EmptyState } from "@/components/ui/misc";
import { cn, whatsappLink } from "@/lib/utils";

export interface InquiryView {
  id: string;
  channel: InquiryChannel;
  status: InquiryStatus;
  name: string | null;
  phone: string | null;
  email: string | null;
  message: string;
  propertyId: string | null;
  propertyLabel: string | null;
  contactId: string | null;
  contactName: string | null;
  leadId: string | null;
  assignedUserId: string | null;
  assignedName: string | null;
  resolutionNote: string | null;
  createdAtLabel: string;
  waitingMinutes: number;
  late: boolean;
}

const TONE: Record<InquiryStatus, "warning" | "primary" | "success" | "neutral"> = {
  open: "warning",
  taken: "primary",
  resolved: "success",
  rejected: "neutral",
};

function waiting(min: number) {
  if (min < 60) return `${min} min`;
  if (min < 60 * 24) return `${Math.floor(min / 60)} h`;
  return `${Math.floor(min / 1440)} d`;
}

export function NewInquiryButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<InquiryChannel>("phone");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [propertyCode, setPropertyCode] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus /> Nueva consulta
      </Button>
      <DialogContent
        title="Nueva consulta"
        description="Llamadas, visitas a la oficina o mensajes que todavía no son un lead."
      >
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await createInquiryAction({ channel, name, phone, email, message, propertyCode });
              if (!r.ok) {
                setErrors(r.fieldErrors ?? {});
                return void toast.error(r.error);
              }
              toast.success("Consulta registrada");
              setOpen(false);
              setName("");
              setPhone("");
              setEmail("");
              setMessage("");
              setPropertyCode("");
              router.refresh();
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Canal" htmlFor="iq-c">
              <Select
                id="iq-c"
                value={channel}
                onChange={(e) => setChannel(e.target.value as InquiryChannel)}
              >
                {INQUIRY_CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {INQUIRY_CHANNEL_LABELS[c]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Nombre" htmlFor="iq-n">
              <Input id="iq-n" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Teléfono" htmlFor="iq-p" error={errors.phone}>
              <Input id="iq-p" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
            <Field label="Email" htmlFor="iq-e" error={errors.email}>
              <Input id="iq-e" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
          </div>
          <Field label="Consulta" htmlFor="iq-m" error={errors.message}>
            <Textarea id="iq-m" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
          </Field>
          <Field label="Código de propiedad (opcional)" htmlFor="iq-pc">
            <Input
              id="iq-pc"
              placeholder="PROP-000001"
              value={propertyCode}
              onChange={(e) => setPropertyCode(e.target.value)}
            />
          </Field>
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

function InquiryCard({
  q,
  canAct,
  canAssign,
  canConvert,
  people,
}: {
  q: InquiryView;
  canAct: boolean;
  canAssign: boolean;
  canConvert: boolean;
  people: { userId: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [op, setOp] = useState<"buy" | "rent" | "temporary_rent">("buy");
  const closed = q.status === "resolved" || q.status === "rejected";
  const wa = whatsappLink(q.phone);

  const act = (
    action: "take" | "assign" | "resolve" | "reject" | "reopen",
    extra: Record<string, unknown> = {},
    ok = "Listo",
  ) =>
    start(async () => {
      const r = await actOnInquiryAction({ id: q.id, action, ...extra });
      if (!r.ok) return void toast.error(r.error);
      toast.success(ok);
      router.refresh();
    });

  return (
    <li className={cn("px-4 py-3", q.late && "bg-warning-soft/30")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="font-semibold">{q.name ?? q.contactName ?? "Sin nombre"}</span>
            <Badge tone="outline">{INQUIRY_CHANNEL_LABELS[q.channel]}</Badge>
            <Badge tone={TONE[q.status]}>{INQUIRY_STATUS_LABELS[q.status]}</Badge>
            {q.late && <Badge tone="danger">Sin tomar hace {waiting(q.waitingMinutes)}</Badge>}
            {q.contactId && !q.leadId && (
              <Link href={`/crm/contacts/${q.contactId}`} className="text-xs text-primary hover:underline">
                Cliente existente
              </Link>
            )}
          </p>
          <p className="mt-1 text-sm whitespace-pre-wrap">{q.message}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {[
              q.phone,
              q.email,
              q.propertyLabel,
              q.createdAtLabel,
              q.assignedName ? `Atiende: ${q.assignedName}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {q.resolutionNote && <p className="mt-1 text-xs">“{q.resolutionNote}”</p>}
          {q.leadId && (
            <Link
              href={`/crm/leads/${q.leadId}`}
              className="mt-1 inline-block text-xs text-primary hover:underline"
            >
              Ver lead
            </Link>
          )}
        </div>
        {canAct && (
          <div className="flex flex-wrap items-center gap-1.5">
            {wa && !closed && (
              <Button size="sm" variant="ghost" asChild>
                <a href={wa} target="_blank" rel="noreferrer">
                  WhatsApp
                </a>
              </Button>
            )}
            {q.status === "open" && (
              <Button size="sm" disabled={pending} onClick={() => act("take", {}, "Consulta tomada")}>
                <UserRoundCheck /> Tomar
              </Button>
            )}
            {canAssign && !closed && people.length > 0 && (
              <Select
                aria-label="Asignar a"
                className="h-8 w-40"
                value=""
                disabled={pending}
                onChange={(e) =>
                  e.target.value && act("assign", { assignedUserId: e.target.value }, "Consulta asignada")
                }
              >
                <option value="">Asignar a…</option>
                {people.map((p) => (
                  <option key={p.userId} value={p.userId}>
                    {p.name}
                  </option>
                ))}
              </Select>
            )}
            {canConvert && !closed && !q.leadId && (
              <span className="flex items-center gap-1">
                <Select
                  aria-label="Operación"
                  className="h-8 w-32"
                  value={op}
                  onChange={(e) => setOp(e.target.value as typeof op)}
                >
                  <option value="buy">Compra</option>
                  <option value="rent">Alquiler</option>
                  <option value="temporary_rent">Temporal</option>
                </Select>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await convertInquiryAction({ id: q.id, operation: op });
                      if (!r.ok) return void toast.error(r.error);
                      toast.success("Lead creado");
                      router.push(`/crm/leads/${r.data.leadId}`);
                    })
                  }
                >
                  <UserPlus /> Crear lead
                </Button>
              </span>
            )}
            {!closed && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    act(
                      "resolve",
                      { note: window.prompt("¿Cómo se resolvió? (opcional)") ?? null },
                      "Resuelta",
                    )
                  }
                >
                  <Check /> Resuelta
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => {
                    const note = window.prompt("¿Por qué se descarta? (spam, duplicada, sin datos…)");
                    if (note) act("reject", { note }, "Descartada");
                  }}
                >
                  <X /> Descartar
                </Button>
              </>
            )}
            {closed && !q.leadId && (
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => act("reopen", {}, "Reabierta")}
              >
                Reabrir
              </Button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

export function InquiryList(props: {
  items: InquiryView[];
  canAct: boolean;
  canAssign: boolean;
  canConvert: boolean;
  people: { userId: string; name: string }[];
  meId: string;
}) {
  if (!props.items.length)
    return (
      <EmptyState
        icon={Inbox}
        title="Bandeja vacía"
        description="Las consultas del sitio web, portales o el asistente virtual llegan acá. También podés cargarlas a mano."
      />
    );
  return (
    <ul className="divide-y">
      {props.items.map((q) => (
        <InquiryCard key={q.id} q={q} {...props} />
      ))}
    </ul>
  );
}
