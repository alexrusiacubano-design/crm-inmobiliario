/**
 * Automatizaciones: disparador → condiciones → acciones. Catálogo de disparadores, campos
 * para condiciones, variables de texto y la evaluación pura de condiciones.
 */
import { INQUIRY_CHANNEL_LABELS, INQUIRY_CHANNELS } from "./communications";
import {
  LEAD_OPERATION_LABELS,
  LEAD_OPERATIONS,
  LEAD_SOURCE_LABELS,
  LEAD_SOURCES,
  LEAD_STATUS_LABELS,
  LEAD_STATUSES,
  PROPERTY_TYPE_LABELS,
  PROPERTY_TYPES,
} from "./crm";
import { DEAL_STAGE_LABELS, DEAL_STAGES } from "./deals";
import {
  PROPERTY_OPERATION_LABELS,
  PROPERTY_OPERATIONS,
  PROPERTY_STATUS_LABELS,
  PROPERTY_STATUSES,
} from "./property";
import { AD_LEVEL_LABELS, AD_LEVELS, PORTAL_LABELS, PORTALS } from "./publications";

export const AUTOMATION_ENTITIES = [
  "lead",
  "inquiry",
  "deal",
  "contract",
  "property",
  "charge",
  "publication",
] as const;
export type AutomationEntity = (typeof AUTOMATION_ENTITIES)[number];

export interface TriggerDef {
  label: string;
  entity: AutomationEntity;
  kind: "event" | "schedule";
  /** Para los programados: qué significa el número de días y su valor sugerido. */
  daysLabel?: string;
  defaultDays?: number;
}

export const AUTOMATION_TRIGGERS = {
  "lead.created": { label: "Entra un lead nuevo", entity: "lead", kind: "event" },
  "lead.assigned": { label: "Se asigna un lead", entity: "lead", kind: "event" },
  "lead.status_changed": { label: "Un lead cambia de estado", entity: "lead", kind: "event" },
  "inquiry.created": { label: "Llega una consulta a la bandeja", entity: "inquiry", kind: "event" },
  "deal.created": { label: "Se inicia una operación", entity: "deal", kind: "event" },
  "offer.created": { label: "Se registra una oferta", entity: "deal", kind: "event" },
  "offer.accepted": { label: "Se acepta una oferta", entity: "deal", kind: "event" },
  "reservation.created": { label: "Se reserva una propiedad", entity: "deal", kind: "event" },
  "deal.closed": { label: "Se cierra una operación", entity: "deal", kind: "event" },
  "deal.fallen": { label: "Se cae una operación", entity: "deal", kind: "event" },
  "contract.created": { label: "Se firma un contrato de alquiler", entity: "contract", kind: "event" },
  "property.status_changed": {
    label: "Una propiedad cambia de estado",
    entity: "property",
    kind: "event",
  },
  "schedule.lead_stale": {
    label: "Lead abierto sin contacto",
    entity: "lead",
    kind: "schedule",
    daysLabel: "Días sin contacto",
    defaultDays: 3,
  },
  "schedule.charge_overdue": {
    label: "Cuota de alquiler vencida",
    entity: "charge",
    kind: "schedule",
    daysLabel: "Días de atraso",
    defaultDays: 5,
  },
  "schedule.contract_ending": {
    label: "Contrato por vencer",
    entity: "contract",
    kind: "schedule",
    daysLabel: "Días antes del vencimiento",
    defaultDays: 60,
  },
  "schedule.reservation_expiring": {
    label: "Reserva por vencer",
    entity: "deal",
    kind: "schedule",
    daysLabel: "Días antes del vencimiento",
    defaultDays: 2,
  },
  "schedule.publication_expiring": {
    label: "Aviso en portal por vencer",
    entity: "publication",
    kind: "schedule",
    daysLabel: "Días antes del vencimiento",
    defaultDays: 5,
  },
} as const satisfies Record<string, TriggerDef>;
export type AutomationTrigger = keyof typeof AUTOMATION_TRIGGERS;
export const AUTOMATION_TRIGGER_KEYS = Object.keys(AUTOMATION_TRIGGERS) as AutomationTrigger[];
export const EVENT_TRIGGERS = AUTOMATION_TRIGGER_KEYS.filter((k) => AUTOMATION_TRIGGERS[k].kind === "event");
export const SCHEDULE_TRIGGERS = AUTOMATION_TRIGGER_KEYS.filter(
  (k) => AUTOMATION_TRIGGERS[k].kind === "schedule",
);

export type FieldType = "enum" | "number" | "boolean";
export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  options?: readonly string[];
  optionLabels?: Record<string, string>;
}

const CURRENCY = { options: ["USD", "UYU"], optionLabels: { USD: "Dólares", UYU: "Pesos" } };

export const ENTITY_FIELDS: Record<AutomationEntity, readonly FieldDef[]> = {
  lead: [
    {
      key: "operation",
      label: "Operación",
      type: "enum",
      options: LEAD_OPERATIONS,
      optionLabels: LEAD_OPERATION_LABELS,
    },
    { key: "source", label: "Origen", type: "enum", options: LEAD_SOURCES, optionLabels: LEAD_SOURCE_LABELS },
    {
      key: "status",
      label: "Estado",
      type: "enum",
      options: LEAD_STATUSES,
      optionLabels: LEAD_STATUS_LABELS,
    },
    { key: "hasAssignee", label: "Tiene responsable", type: "boolean" },
    { key: "daysWithoutContact", label: "Días sin contacto", type: "number" },
  ],
  inquiry: [
    {
      key: "channel",
      label: "Canal",
      type: "enum",
      options: INQUIRY_CHANNELS,
      optionLabels: INQUIRY_CHANNEL_LABELS,
    },
    { key: "hasProperty", label: "Pregunta por una propiedad", type: "boolean" },
    { key: "hasContact", label: "Es un cliente existente", type: "boolean" },
  ],
  deal: [
    {
      key: "operation",
      label: "Operación",
      type: "enum",
      options: PROPERTY_OPERATIONS,
      optionLabels: PROPERTY_OPERATION_LABELS,
    },
    { key: "stage", label: "Etapa", type: "enum", options: DEAL_STAGES, optionLabels: DEAL_STAGE_LABELS },
    { key: "currency", label: "Moneda", type: "enum", ...CURRENCY },
    { key: "price", label: "Precio", type: "number" },
  ],
  contract: [
    { key: "currency", label: "Moneda", type: "enum", ...CURRENCY },
    { key: "rent", label: "Alquiler mensual", type: "number" },
    { key: "daysToEnd", label: "Días para el vencimiento", type: "number" },
  ],
  property: [
    { key: "type", label: "Tipo", type: "enum", options: PROPERTY_TYPES, optionLabels: PROPERTY_TYPE_LABELS },
    {
      key: "status",
      label: "Estado nuevo",
      type: "enum",
      options: PROPERTY_STATUSES,
      optionLabels: PROPERTY_STATUS_LABELS,
    },
    {
      key: "fromStatus",
      label: "Estado anterior",
      type: "enum",
      options: PROPERTY_STATUSES,
      optionLabels: PROPERTY_STATUS_LABELS,
    },
  ],
  charge: [
    { key: "currency", label: "Moneda", type: "enum", ...CURRENCY },
    { key: "balance", label: "Saldo adeudado", type: "number" },
    { key: "daysOverdue", label: "Días de atraso", type: "number" },
  ],
  publication: [
    { key: "portal", label: "Portal", type: "enum", options: PORTALS, optionLabels: PORTAL_LABELS },
    { key: "level", label: "Nivel", type: "enum", options: AD_LEVELS, optionLabels: AD_LEVEL_LABELS },
    { key: "daysToExpire", label: "Días para el vencimiento", type: "number" },
  ],
};

export const CONDITION_OPS = ["eq", "neq", "gte", "lte"] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];
export const CONDITION_OP_LABELS: Record<ConditionOp, string> = {
  eq: "es",
  neq: "no es",
  gte: "mayor o igual a",
  lte: "menor o igual a",
};
export function opsFor(type: FieldType): ConditionOp[] {
  return type === "number" ? ["gte", "lte", "eq"] : ["eq", "neq"];
}

export interface Condition {
  field: string;
  op: ConditionOp;
  value: string | number | boolean;
}

export type Facts = Record<string, string | number | boolean | null | undefined>;

/** Todas las condiciones deben cumplirse (Y). Un campo inexistente nunca cumple. */
export function evaluateConditions(conditions: readonly Condition[], facts: Facts): boolean {
  return conditions.every((c) => {
    const v = facts[c.field];
    if (v === null || v === undefined) return c.op === "neq";
    if (typeof v === "number") {
      const target = Number(c.value);
      if (!Number.isFinite(target)) return false;
      if (c.op === "gte") return v >= target;
      if (c.op === "lte") return v <= target;
      if (c.op === "eq") return v === target;
      return v !== target;
    }
    if (typeof v === "boolean") {
      const target = c.value === true || c.value === "true";
      return c.op === "neq" ? v !== target : v === target;
    }
    return c.op === "neq" ? v !== String(c.value) : v === String(c.value);
  });
}

/** Variables disponibles en los textos de notificaciones y tareas. */
export const AUTOMATION_VARIABLES = {
  codigo: "Código (lead, operación, contrato…)",
  nombre: "Cliente o contacto",
  propiedad: "Propiedad",
  responsable: "Responsable",
  dias: "Días (sin contacto, de atraso, para vencer)",
  monto: "Precio, alquiler o saldo",
  estado: "Estado o etapa",
} as const;
export type AutomationVariable = keyof typeof AUTOMATION_VARIABLES;

export function renderAutomationText(
  text: string,
  vars: Partial<Record<AutomationVariable, string | null | undefined>>,
): string {
  return text.replace(/\{\{\s*([a-z]+)\s*\}\}/gi, (whole, key: string) => {
    const k = key.toLowerCase();
    if (!(k in AUTOMATION_VARIABLES)) return whole;
    const v = vars[k as AutomationVariable];
    return v && String(v).trim() ? String(v).trim() : "—";
  });
}

export const ACTION_TYPES = ["notify", "task", "email", "assign", "tag", "webhook"] as const;
export type ActionType = (typeof ACTION_TYPES)[number];
export const ACTION_TYPE_LABELS: Record<ActionType, string> = {
  notify: "Enviar notificación",
  task: "Crear tarea",
  assign: "Asignar en rueda",
  tag: "Etiquetar al contacto",
  webhook: "Llamar a un webhook",
  email: "Enviar email al cliente",
};
/** Acciones que necesitan un contacto o un lead en la entidad. */
export const ACTION_ENTITIES: Record<ActionType, readonly AutomationEntity[] | "all"> = {
  notify: "all",
  task: "all",
  assign: ["lead"],
  tag: ["lead", "inquiry", "deal", "contract", "charge"],
  webhook: "all",
  email: ["lead", "inquiry", "deal", "contract", "charge"],
};
export function actionAllowed(action: ActionType, entity: AutomationEntity): boolean {
  const e = ACTION_ENTITIES[action];
  return e === "all" || e.includes(entity);
}

export const RECIPIENTS = ["assignee", "role", "user"] as const;
export type Recipient = (typeof RECIPIENTS)[number];
export const RECIPIENT_LABELS: Record<Recipient, string> = {
  assignee: "El responsable",
  role: "Todos los de un rol",
  user: "Un usuario",
};

export const RUN_STATUSES = ["success", "partial", "error"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  success: "Ejecutada",
  partial: "Con errores parciales",
  error: "Falló",
};

/** Siguiente usuario de una rueda (round-robin), salteando a los que ya no están. */
export function nextInRotation(
  userIds: readonly string[],
  lastUserId: string | null | undefined,
): string | null {
  if (!userIds.length) return null;
  const i = lastUserId ? userIds.indexOf(lastUserId) : -1;
  return userIds[(i + 1) % userIds.length] ?? null;
}

/** Webhooks: solo HTTPS a hosts públicos (sin IPs privadas ni localhost). */
export function isSafeWebhookUrl(raw: string): boolean {
  const m = /^https:\/\/([^/?#]+)(?:[/?#].*)?$/i.exec(raw.trim());
  if (!m) return false;
  const authority = m[1] ?? "";
  if (authority.includes("@")) return false;
  const host = authority.startsWith("[") ? authority : authority.replace(/:\d+$/, "");
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal"))
    return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a = 0, b = 0] = h.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31))
      return false;
    if ((a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224) return false;
  }
  if (h.includes(":")) return false; // IPv6 literal: no se permite
  return true;
}

/** Reglas sugeridas para empezar (se abren en el editor para revisarlas antes de guardar). */
export interface RuleTemplate {
  key: string;
  name: string;
  description: string;
  trigger: AutomationTrigger;
  days?: number;
  conditions: Condition[];
  actions: Record<string, unknown>[];
}

export const RULE_TEMPLATES: RuleTemplate[] = [
  {
    key: "lead-notify",
    name: "Avisar al responsable de un lead nuevo",
    description: "Notificación inmediata a quien recibe el lead.",
    trigger: "lead.created",
    conditions: [],
    actions: [
      {
        type: "notify",
        to: "assignee",
        title: "Nuevo lead {{codigo}}: {{nombre}}",
        body: "Contactalo hoy: los leads respondidos en la primera hora convierten mucho más.",
      },
    ],
  },
  {
    key: "portal-round-robin",
    name: "Repartir en rueda los leads de portales",
    description: "Asigna cada lead de portal al siguiente agente de la lista.",
    trigger: "lead.created",
    conditions: [{ field: "source", op: "eq", value: "portal" }],
    actions: [{ type: "assign", userIds: [] }],
  },
  {
    key: "lead-stale",
    name: "Seguimiento de leads sin contacto",
    description: "Tarea y aviso cuando un lead abierto pasa días sin contacto.",
    trigger: "schedule.lead_stale",
    days: 3,
    conditions: [],
    actions: [
      {
        type: "notify",
        to: "assignee",
        title: "{{nombre}} lleva {{dias}} días sin contacto",
        body: "Lead {{codigo}}",
      },
      { type: "task", to: "assignee", title: "Llamar a {{nombre}} ({{codigo}})", dueInDays: 0 },
    ],
  },
  {
    key: "inquiry-reception",
    name: "Consulta nueva para recepción",
    description: "Avisa a recepción cada vez que entra una consulta a la bandeja.",
    trigger: "inquiry.created",
    conditions: [],
    actions: [
      {
        type: "notify",
        to: "role",
        roleKey: "reception",
        title: "Nueva consulta de {{nombre}}",
        body: "{{propiedad}}",
      },
    ],
  },
  {
    key: "charge-overdue",
    name: "Cobranza de cuotas vencidas",
    description: "Tarea de cobro cuando una cuota lleva días de atraso.",
    trigger: "schedule.charge_overdue",
    days: 5,
    conditions: [],
    actions: [
      {
        type: "task",
        to: "assignee",
        title: "Cobrar a {{nombre}}: {{monto}} ({{dias}} días de atraso)",
        dueInDays: 0,
      },
      { type: "tag", tag: "Moroso" },
    ],
  },
  {
    key: "charge-reminder-email",
    name: "Recordatorio de pago por email",
    description:
      "Email al inquilino cuando la cuota lleva días vencida (requiere configurar el envío de emails).",
    trigger: "schedule.charge_overdue",
    days: 3,
    conditions: [],
    actions: [
      {
        type: "email",
        subject: "Recordatorio: cuota de alquiler pendiente",
        body: "Hola {{nombre}}:\n\nTe recordamos que la cuota de {{propiedad}} tiene un saldo pendiente de {{monto}} ({{dias}} días de atraso). Si ya la pagaste, ignorá este mensaje.\n\nGracias.",
      },
    ],
  },
  {
    key: "contract-ending",
    name: "Renovación de contratos",
    description: "Tarea para negociar la renovación antes del vencimiento.",
    trigger: "schedule.contract_ending",
    days: 60,
    conditions: [],
    actions: [
      { type: "task", to: "assignee", title: "Renovación {{codigo}}: vence en {{dias}} días", dueInDays: 1 },
    ],
  },
  {
    key: "reservation-expiring",
    name: "Reserva por vencer",
    description: "Aviso al responsable antes de que venza una reserva.",
    trigger: "schedule.reservation_expiring",
    days: 2,
    conditions: [],
    actions: [{ type: "notify", to: "assignee", title: "La reserva de {{codigo}} vence en {{dias}} días" }],
  },
  {
    key: "deal-closed",
    name: "Operación cerrada para administración",
    description: "Avisa a administración para facturar y liquidar comisiones.",
    trigger: "deal.closed",
    conditions: [],
    actions: [
      {
        type: "notify",
        to: "role",
        roleKey: "accounting",
        title: "Operación {{codigo}} cerrada por {{monto}}",
        body: "{{propiedad}} · {{responsable}}",
      },
    ],
  },
];
