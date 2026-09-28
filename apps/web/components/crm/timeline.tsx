"use client";

import {
  ArrowRightLeft,
  Building,
  CalendarClock,
  FilePlus2,
  GitMerge,
  Mail,
  MessageCircle,
  Phone,
  Search,
  StickyNote,
  UserPlus,
  UserRoundCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  INTERACTION_TYPE_LABELS,
  INTERACTION_TYPES,
  LEAD_LOST_REASON_LABELS,
  LEAD_STATUS_LABELS,
  type InteractionType,
  type LeadLostReason,
  type LeadStatus,
} from "@crm/shared/crm";
import { loadTimelineAction, logInteractionAction } from "@/app/(app)/crm/actions";
import { Button } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/form";
import { Card, EmptyState } from "@/components/ui/misc";
import { cn, formatDateTime } from "@/lib/utils";

export interface TimelineItem {
  id: string;
  type: string;
  direction: string | null;
  body: string | null;
  payload: unknown;
  occurredAt: string;
  leadId: string | null;
  leadCode: string | null;
  actorName: string | null;
}

const ICONS: Record<string, LucideIcon> = {
  note: StickyNote,
  call: Phone,
  whatsapp: MessageCircle,
  email: Mail,
  meeting: Users,
  contact_created: UserPlus,
  contact_updated: UserRoundCheck,
  contact_merged: GitMerge,
  lead_created: FilePlus2,
  lead_status_changed: ArrowRightLeft,
  lead_assigned: UserRoundCheck,
  search_updated: Search,
  owner_updated: Building,
};

function describe(item: TimelineItem): string {
  const p = (item.payload ?? {}) as Record<string, unknown>;
  const dir = item.direction === "inbound" ? " recibido" : item.direction === "outbound" ? " realizado" : "";
  switch (item.type) {
    case "note":
      return "Nota";
    case "call":
      return item.direction === "inbound" ? "Llamada recibida" : "Llamada realizada";
    case "whatsapp":
      return `WhatsApp${dir}`;
    case "email":
      return `Email${dir}`;
    case "meeting":
      return "Reunión";
    case "contact_created":
      return "Se creó el contacto";
    case "contact_updated":
      return "Se editaron los datos del contacto";
    case "contact_merged":
      return "Se fusionó un contacto duplicado";
    case "lead_created":
      return `Nuevo lead ${String(p.code ?? item.leadCode ?? "")}`;
    case "lead_status_changed": {
      const from = LEAD_STATUS_LABELS[p.from as LeadStatus] ?? String(p.from);
      const to = LEAD_STATUS_LABELS[p.to as LeadStatus] ?? String(p.to);
      const reason = p.lostReason ? ` · ${LEAD_LOST_REASON_LABELS[p.lostReason as LeadLostReason]}` : "";
      return `${from} → ${to}${reason}${p.automatic ? " (automático)" : ""}`;
    }
    case "lead_assigned":
      return "Cambio de responsable";
    case "search_updated":
      return "Se actualizó la búsqueda";
    case "owner_updated":
      return "Datos de propietario";
    default:
      return item.type;
  }
}

export function Timeline({
  initial,
  nextCursor: initialCursor,
  contactId,
  leadId,
  canLog,
  showLeadLinks = false,
}: {
  initial: TimelineItem[];
  nextCursor: string | null;
  contactId?: string;
  leadId?: string;
  canLog: boolean;
  showLeadLinks?: boolean;
}) {
  const [items, setItems] = useState(initial);
  const [cursor, setCursor] = useState(initialCursor);
  const [type, setType] = useState<InteractionType>("call");
  const [direction, setDirection] = useState<"outbound" | "inbound">("outbound");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [loadingMore, startLoadingMore] = useTransition();

  const reload = async () => {
    const r = await loadTimelineAction({ contactId, leadId });
    if (r.ok) {
      setItems(r.data.items);
      setCursor(r.data.nextCursor);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await logInteractionAction({
        contactId,
        leadId,
        type,
        direction: type === "note" || type === "meeting" ? null : direction,
        body,
      });
      if (!r.ok) return setError(r.fieldErrors?.body?.[0] ?? r.error);
      setBody("");
      toast.success("Registrado en el timeline");
      await reload();
    });
  };

  const loadMore = () =>
    startLoadingMore(async () => {
      const r = await loadTimelineAction({ contactId, leadId, before: cursor });
      if (!r.ok) return void toast.error(r.error);
      setItems((prev) => [...prev, ...r.data.items]);
      setCursor(r.data.nextCursor);
    });

  return (
    <Card>
      {canLog && (
        <form onSubmit={submit} className="grid gap-2 border-b p-4">
          <div className="flex flex-wrap gap-2">
            <Select
              aria-label="Tipo de interacción"
              value={type}
              onChange={(e) => setType(e.target.value as InteractionType)}
              className="h-8 w-36 text-sm"
            >
              {INTERACTION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {INTERACTION_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
            {type !== "note" && type !== "meeting" && (
              <Select
                aria-label="Dirección"
                value={direction}
                onChange={(e) => setDirection(e.target.value as "outbound" | "inbound")}
                className="h-8 w-40 text-sm"
              >
                <option value="outbound">Realizada por mí</option>
                <option value="inbound">Recibida</option>
              </Select>
            )}
          </div>
          <Textarea
            aria-label="Detalle"
            rows={2}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={type === "note" ? "Escribí una nota…" : "¿Qué se habló?"}
          />
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Registro manual. El envío de WhatsApp y email desde el CRM llega en la Fase 10.
            </p>
            <Button type="submit" size="sm" loading={pending} disabled={!body.trim()}>
              Registrar
            </Button>
          </div>
        </form>
      )}
      {items.length === 0 ? (
        <EmptyState icon={CalendarClock} title="Sin actividad todavía" />
      ) : (
        <ol className="relative px-4 py-3">
          {items.map((item) => {
            const Icon = ICONS[item.type] ?? CalendarClock;
            const manual = ["note", "call", "whatsapp", "email", "meeting"].includes(item.type);
            return (
              <li key={item.id} className="relative flex gap-3 pb-4 last:pb-1">
                <span
                  className={cn(
                    "z-10 flex size-7 shrink-0 items-center justify-center rounded-full border bg-surface",
                    manual ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  <Icon className="size-3.5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1 pt-0.5">
                  <p className="text-sm">
                    <span className="font-medium">{describe(item)}</span>
                    {showLeadLinks && item.leadId && item.leadCode && (
                      <Link
                        href={`/crm/leads/${item.leadId}`}
                        className="ml-1.5 font-mono text-xs text-primary hover:underline"
                      >
                        {item.leadCode}
                      </Link>
                    )}
                  </p>
                  {item.body && (
                    <p className="mt-0.5 whitespace-pre-wrap text-sm text-foreground/85">{item.body}</p>
                  )}
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {item.actorName ?? "Sistema"} · {formatDateTime(item.occurredAt)}
                  </p>
                </div>
              </li>
            );
          })}
          {cursor && (
            <li className="pl-10">
              <Button variant="ghost" size="sm" onClick={loadMore} loading={loadingMore}>
                Ver más
              </Button>
            </li>
          )}
        </ol>
      )}
    </Card>
  );
}
