import type { AgendaEvent } from "@crm/core";
import type { EventType } from "@crm/shared/agenda";

/** Lo que el cliente necesita de un evento (las fechas llegan como Date por RSC). */
export type AgendaEventView = Pick<
  AgendaEvent,
  | "id"
  | "type"
  | "status"
  | "title"
  | "description"
  | "location"
  | "startsAt"
  | "endsAt"
  | "allDay"
  | "contactId"
  | "leadId"
  | "propertyId"
  | "assignedUserId"
  | "outcome"
  | "rating"
  | "feedback"
  | "contactName"
  | "propertyLabel"
  | "propertyCode"
  | "assignedName"
  | "canManage"
>;

export function toView(e: AgendaEvent): AgendaEventView {
  return {
    id: e.id,
    type: e.type,
    status: e.status,
    title: e.title,
    description: e.description,
    location: e.location,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    allDay: e.allDay,
    contactId: e.contactId,
    leadId: e.leadId,
    propertyId: e.propertyId,
    assignedUserId: e.assignedUserId,
    outcome: e.outcome,
    rating: e.rating,
    feedback: e.feedback,
    contactName: e.contactName,
    propertyLabel: e.propertyLabel,
    propertyCode: e.propertyCode,
    assignedName: e.assignedName,
    canManage: e.canManage,
  };
}

/** Color por tipo (tokens del tema, funcionan en claro y oscuro). */
export const TYPE_TONE: Record<EventType, string> = {
  visit: "bg-primary-soft text-primary border-primary/30",
  meeting: "bg-success-soft text-success border-success/30",
  call: "bg-warning-soft text-[color-mix(in_oklch,var(--warning)_70%,var(--foreground))] border-warning/30",
  reminder: "bg-danger-soft text-danger border-danger/30",
  task: "bg-surface-muted text-foreground border-border-strong",
  other: "bg-surface-muted text-muted-foreground border-border",
};

export const TYPE_DOT: Record<EventType, string> = {
  visit: "bg-primary",
  meeting: "bg-success",
  call: "bg-warning",
  reminder: "bg-danger",
  task: "bg-foreground/60",
  other: "bg-muted-foreground",
};
