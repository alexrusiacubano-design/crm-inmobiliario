"use client";

import {
  Check,
  ChevronDown,
  Heart,
  Home,
  SearchX,
  ImageOff,
  MessageCircle,
  RotateCcw,
  Send,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { MATCH_STATUS_LABELS, type MatchReason, type MatchStatus } from "@crm/shared/matching";
import { setMatchStatusAction } from "@/app/(app)/commercial/matching/actions";
import { PrivateImage } from "@/components/properties/private-image";
import { price } from "@/components/properties/format";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/misc";
import { cn, whatsappLink } from "@/lib/utils";

export interface MatchItem {
  id: string;
  status: MatchStatus;
  score: number;
  reasons: MatchReason[];
  active: boolean;
  note: string | null;
  propertyId: string;
  code: string;
  displayTitle: string;
  zone: string;
  specs: string;
  price: { currency: "UYU" | "USD"; amountMinor: string } | null;
  coverMediaId: string | null;
  agentName: string | null;
}

const STATUS_TONE: Record<MatchStatus, "neutral" | "primary" | "success" | "danger"> = {
  suggested: "neutral",
  sent: "primary",
  interested: "success",
  discarded: "danger",
};

export function ScoreBadge({ score }: { score: number }) {
  const tone = score >= 90 ? "success" : score >= 70 ? "primary" : "warning";
  return (
    <Badge tone={tone} title="Compatibilidad con la búsqueda">
      {score} %
    </Badge>
  );
}

function shareText(firstName: string, m: MatchItem): string {
  const parts = [
    `Hola${firstName ? ` ${firstName}` : ""}! Te comparto una propiedad que puede interesarte:`,
    `${m.displayTitle}${m.zone ? ` en ${m.zone}` : ""}`,
    m.price ? price(m.price.amountMinor, m.price.currency) : null,
    m.specs || null,
    `Ref. ${m.code}`,
  ];
  return parts.filter(Boolean).join("\n");
}

export function MatchList({
  items,
  canManage,
  phone,
  firstName,
  hasProfile,
  open,
}: {
  items: MatchItem[];
  canManage: boolean;
  phone: string | null;
  firstName: string;
  hasProfile: boolean;
  open: boolean;
}) {
  const [showRest, setShowRest] = useState(false);
  if (!hasProfile) {
    return (
      <EmptyState
        icon={SearchX}
        className="py-8"
        title="Sin búsqueda cargada"
        description="Completá “Qué busca” para que el sistema sugiera propiedades del inventario."
      />
    );
  }
  const main = items.filter((i) => i.active && i.status !== "discarded");
  const rest = items.filter((i) => !i.active || i.status === "discarded");
  return (
    <div className="grid gap-3">
      {main.length === 0 && (
        <EmptyState
          icon={Home}
          className="py-8"
          title={open ? "Ninguna propiedad cumple por ahora" : "Lead cerrado"}
          description={
            open
              ? "Cuando entre al inventario algo compatible aparece acá. Probá ampliar zona o presupuesto."
              : "Los leads cerrados no reciben sugerencias nuevas."
          }
        />
      )}
      {main.map((m) => (
        <MatchCard key={m.id} m={m} canManage={canManage} phone={phone} firstName={firstName} />
      ))}
      {rest.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowRest(!showRest)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className={cn("size-3.5 transition-transform", showRest && "rotate-180")} />
            Descartadas o que ya no cumplen ({rest.length})
          </button>
          {showRest && (
            <div className="mt-2 grid gap-3 opacity-80">
              {rest.map((m) => (
                <MatchCard key={m.id} m={m} canManage={canManage} phone={phone} firstName={firstName} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MatchCard({
  m,
  canManage,
  phone,
  firstName,
}: {
  m: MatchItem;
  canManage: boolean;
  phone: string | null;
  firstName: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const wa = whatsappLink(phone);

  const set = (status: MatchStatus, note?: string) =>
    start(async () => {
      const r = await setMatchStatusAction({ matchId: m.id, status, note: note ?? null });
      if (!r.ok) return void toast.error(r.error);
      toast.success(MATCH_STATUS_LABELS[status]);
      router.refresh();
    });

  return (
    <article className="flex gap-3 rounded-lg border bg-surface p-3">
      <Link
        href={`/properties/${m.propertyId}`}
        className="relative size-20 shrink-0 overflow-hidden rounded-md border bg-surface-muted"
      >
        {m.coverMediaId ? (
          <PrivateImage mediaId={m.coverMediaId} alt="" />
        ) : (
          <span className="flex size-full items-center justify-center text-muted-foreground">
            <ImageOff className="size-4" aria-hidden />
          </span>
        )}
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/properties/${m.propertyId}`} className="truncate text-sm font-medium hover:underline">
            {m.displayTitle}
          </Link>
          <ScoreBadge score={m.score} />
          {m.status !== "suggested" && (
            <Badge tone={STATUS_TONE[m.status]}>{MATCH_STATUS_LABELS[m.status]}</Badge>
          )}
          {!m.active && <Badge tone="outline">Ya no cumple</Badge>}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          <span className="font-mono">{m.code}</span>
          {m.zone ? ` · ${m.zone}` : ""}
          {m.specs ? ` · ${m.specs}` : ""}
          {m.agentName ? ` · ${m.agentName}` : ""}
        </p>
        <p className="mt-1 text-sm font-semibold">
          {m.price ? price(m.price.amountMinor, m.price.currency) : "Sin precio publicado"}
        </p>
        {m.reasons.length > 0 && (
          <ul className="mt-1.5 flex flex-wrap gap-1">
            {m.reasons.map((r) => (
              <li key={r.text}>
                <Badge tone={r.kind === "ok" ? "success" : "warning"}>{r.text}</Badge>
              </li>
            ))}
          </ul>
        )}
        {m.note && <p className="mt-1 text-xs text-muted-foreground">“{m.note}”</p>}
        {canManage && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {m.status === "suggested" && wa && (
              <Button size="sm" variant="secondary" disabled={pending} asChild>
                <a
                  href={`${wa}?text=${encodeURIComponent(shareText(firstName, m))}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => set("sent", "Enviada por WhatsApp")}
                >
                  <MessageCircle /> Enviar por WhatsApp
                </a>
              </Button>
            )}
            {m.status === "suggested" && (
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => set("sent")}>
                <Send /> Marcar enviada
              </Button>
            )}
            {(m.status === "suggested" || m.status === "sent") && (
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => set("interested")}>
                <Heart /> Le interesa
              </Button>
            )}
            {m.status !== "discarded" && (
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  const why = window.prompt("¿Por qué la descarta? (opcional)") ?? undefined;
                  set("discarded", why);
                }}
              >
                <X /> Descartar
              </Button>
            )}
            {m.status === "discarded" && (
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => set("suggested")}>
                <RotateCcw /> Volver a sugerir
              </Button>
            )}
            {m.status === "interested" && (
              <span className="flex items-center gap-1 px-2 text-xs text-success">
                <Check className="size-3.5" /> Coordiná la visita desde Agenda
              </span>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
