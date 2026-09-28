/**
 * Agenda (Fase 5): visitas, reuniones, llamadas, recordatorios y tareas con fecha. Una visita
 * que ya pasó queda "sin cerrar" hasta que alguien registra cómo salió.
 */

export const EVENT_TYPES = ["visit", "meeting", "call", "reminder", "task", "other"] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  visit: "Visita",
  meeting: "Reunión",
  call: "Llamada",
  reminder: "Recordatorio",
  task: "Tarea",
  other: "Otro",
};

export const EVENT_STATUSES = ["scheduled", "done", "cancelled", "no_show"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];
export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  scheduled: "Agendado",
  done: "Realizado",
  cancelled: "Cancelado",
  no_show: "No se presentó",
};

/** Resultado de una visita, para seguimiento y futuras métricas de conversión. */
export const VISIT_OUTCOMES = ["interested", "second_visit", "offer_intent", "not_interested"] as const;
export type VisitOutcome = (typeof VISIT_OUTCOMES)[number];
export const VISIT_OUTCOME_LABELS: Record<VisitOutcome, string> = {
  interested: "Le interesó",
  second_visit: "Quiere una segunda visita",
  offer_intent: "Va a hacer una oferta",
  not_interested: "No le interesó",
};

/** Tipos que cuentan como "visita" para permisos (`visit.*`); el resto usa `task.*`. */
export function isVisitType(type: EventType): boolean {
  return type === "visit";
}

/** Solo un evento agendado puede cerrarse; uno cerrado puede volver a agendarse. */
export function canCloseEvent(status: EventStatus): boolean {
  return status === "scheduled";
}
