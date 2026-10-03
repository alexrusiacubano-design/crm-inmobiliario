/**
 * Comunicaciones (Fase 10): bandeja de consultas entrantes, chat interno y plantillas de
 * mensajes con variables. El envío por WhatsApp/email abre la app del usuario (wa.me / mailto)
 * hasta que se conecte un proveedor; lo enviado queda en el timeline.
 */

export const INQUIRY_CHANNELS = ["web", "portal", "whatsapp", "email", "phone", "bot", "other"] as const;
export type InquiryChannel = (typeof INQUIRY_CHANNELS)[number];
export const INQUIRY_CHANNEL_LABELS: Record<InquiryChannel, string> = {
  web: "Sitio web",
  portal: "Portal inmobiliario",
  whatsapp: "WhatsApp",
  email: "Email",
  phone: "Llamada",
  bot: "Asistente virtual",
  other: "Otro",
};

export const INQUIRY_STATUSES = ["open", "taken", "resolved", "rejected"] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];
export const INQUIRY_STATUS_LABELS: Record<InquiryStatus, string> = {
  open: "Abierta",
  taken: "Tomada",
  resolved: "Resuelta",
  rejected: "Descartada",
};

/** Minutos sin tomar a partir de los cuales una consulta se marca demorada. */
export const INQUIRY_SLA_MINUTES = 60;

export const TEMPLATE_CHANNELS = ["whatsapp", "email"] as const;
export type TemplateChannel = (typeof TEMPLATE_CHANNELS)[number];
export const TEMPLATE_CHANNEL_LABELS: Record<TemplateChannel, string> = {
  whatsapp: "WhatsApp",
  email: "Email",
};

/** Variables disponibles en las plantillas. */
export const TEMPLATE_VARIABLES = {
  nombre: "Nombre del cliente",
  apellido: "Apellido del cliente",
  agente: "Tu nombre",
  inmobiliaria: "Nombre de la inmobiliaria",
  propiedad: "Título de la propiedad",
  codigo: "Código de la propiedad",
  direccion: "Dirección de la propiedad",
  precio: "Precio publicado",
  fecha: "Fecha (para visitas)",
  hora: "Hora (para visitas)",
} as const;
export type TemplateVariable = keyof typeof TEMPLATE_VARIABLES;

/** Reemplaza {{variable}}; las que no tienen valor quedan como "…" para que se note al revisar. */
export function renderTemplate(
  body: string,
  values: Partial<Record<TemplateVariable, string | null | undefined>>,
): string {
  return body.replace(/\{\{\s*([a-záéíóúñ_]+)\s*\}\}/gi, (_, key: string) => {
    const k = key.toLowerCase() as TemplateVariable;
    if (!(k in TEMPLATE_VARIABLES)) return `{{${key}}}`;
    const v = values[k];
    return v && v.trim() ? v.trim() : "…";
  });
}

/** Variables usadas en un texto que no existen (para validar al guardar). */
export function unknownVariables(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g)) {
    const k = (m[1] ?? "").toLowerCase();
    if (!(k in TEMPLATE_VARIABLES)) out.add(k);
  }
  return [...out];
}

/** Plantillas sugeridas para empezar (se cargan si la organización no tiene ninguna). */
export const DEFAULT_TEMPLATES: { name: string; channel: TemplateChannel; subject?: string; body: string }[] =
  [
    {
      name: "Primer contacto",
      channel: "whatsapp",
      body: "Hola {{nombre}}, soy {{agente}} de {{inmobiliaria}}. Recibimos tu consulta y quiero ayudarte a encontrar lo que buscás. ¿Cuándo te queda cómodo que hablemos?",
    },
    {
      name: "Envío de propiedad",
      channel: "whatsapp",
      body: "Hola {{nombre}}! Te comparto una propiedad que puede interesarte: {{propiedad}} ({{codigo}}) en {{direccion}}, {{precio}}. ¿Te gustaría coordinar una visita?",
    },
    {
      name: "Confirmación de visita",
      channel: "whatsapp",
      body: "Hola {{nombre}}, te confirmo la visita a {{propiedad}} el {{fecha}} a las {{hora}} en {{direccion}}. Cualquier cambio avisame. {{agente}} · {{inmobiliaria}}",
    },
    {
      name: "Seguimiento",
      channel: "email",
      subject: "Seguimiento de tu búsqueda — {{inmobiliaria}}",
      body: "Hola {{nombre}}:\n\nTe escribo para saber cómo seguís con tu búsqueda. Si querés, te preparo una selección nueva de propiedades.\n\nSaludos,\n{{agente}}\n{{inmobiliaria}}",
    },
  ];
