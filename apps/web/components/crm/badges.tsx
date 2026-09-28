import { Mail, MessageCircle, Phone } from "lucide-react";
import { CHANNEL_TYPE_LABELS, LEAD_STATUS_LABELS, type ChannelType, type LeadStatus } from "@crm/shared/crm";
import { Badge } from "@/components/ui/misc";

const STATUS_TONE: Record<LeadStatus, "neutral" | "primary" | "success" | "warning" | "danger" | "outline"> =
  {
    new: "warning",
    contacted: "primary",
    qualified: "primary",
    visit: "primary",
    offer: "primary",
    reservation: "success",
    won: "success",
    lost: "neutral",
  };

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{LEAD_STATUS_LABELS[status]}</Badge>;
}

export function ChannelIcon({ type, className }: { type: ChannelType; className?: string }) {
  const Icon = type === "email" ? Mail : type === "whatsapp" ? MessageCircle : Phone;
  return <Icon className={className ?? "size-3.5"} aria-label={CHANNEL_TYPE_LABELS[type]} />;
}

/** Enlace de contacto real (tel:, wa.me, mailto:). No simula envíos: abre la app del usuario. */
export function channelHref(type: ChannelType, normalized: string): string {
  if (type === "email") return `mailto:${normalized}`;
  if (type === "whatsapp") return `https://wa.me/${normalized.replace(/\D/g, "")}`;
  return `tel:${normalized}`;
}
