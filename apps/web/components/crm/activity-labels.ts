import {
  LEAD_LOST_REASON_LABELS,
  LEAD_STATUS_LABELS,
  type LeadLostReason,
  type LeadStatus,
} from "@crm/shared/crm";

/** Texto de cada entrada del timeline (se usa en el cliente y en el servidor). */
export function describeActivity(item: {
  type: string;
  direction: string | null;
  payload: unknown;
  leadCode: string | null;
}): string {
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
    case "visit":
      return "Visita realizada";
    case "task":
      return "Tarea completada";
    default:
      return item.type;
  }
}
