/**
 * Asistente virtual del sitio web: responde preguntas frecuentes por palabras clave, busca
 * propiedades publicadas y deriva a la bandeja lo que no puede resolver. Sin IA externa.
 */

export interface BotFaq {
  question: string;
  keywords: string[];
  answer: string;
}

/** Minúsculas y sin tildes, para comparar palabras clave. */
function botNormalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** La pregunta frecuente con más palabras clave presentes (null si ninguna coincide). */
export function matchFaq(text: string, faqs: readonly BotFaq[]): BotFaq | null {
  const t = ` ${botNormalize(text)} `;
  let best: BotFaq | null = null;
  let bestScore = 0;
  for (const f of faqs) {
    let score = 0;
    for (const k of f.keywords) {
      const nk = botNormalize(k);
      if (!nk) continue;
      // Coincidencia por palabra (o prefijo de palabra: "garant" encuentra "garantía").
      if (t.includes(` ${nk}`)) score += nk.includes(" ") ? 2 : 1;
    }
    if (score > bestScore) {
      best = f;
      bestScore = score;
    }
  }
  return best;
}

/** "prop 12", "PROP-000012" o "propiedad 12" → "PROP-000012". */
export function extractPropertyCode(text: string): string | null {
  const m = /\bprop(?:iedad)?[\s\-#]*0*(\d{1,6})\b/i.exec(text);
  return m ? `PROP-${(m[1] ?? "").padStart(6, "0")}` : null;
}

export const DEFAULT_BOT_GREETING =
  "¡Hola! Soy el asistente virtual de la inmobiliaria. Puedo mostrarte propiedades, responder preguntas frecuentes o pasarte con un asesor.";
export const DEFAULT_BOT_HANDOFF =
  "¡Gracias! Un asesor te va a contactar a la brevedad en horario de oficina.";

export const DEFAULT_BOT_FAQS: BotFaq[] = [
  {
    question: "¿Cuál es el horario de atención?",
    keywords: ["horario", "hora", "abren", "atienden", "abierto"],
    answer: "Atendemos de lunes a viernes de 9 a 18 h y los sábados de 10 a 13 h.",
  },
  {
    question: "¿Qué garantías aceptan para alquilar?",
    keywords: ["garant", "fiador", "anda", "cgn", "contaduria", "seguro de alquiler", "deposito"],
    answer:
      "Aceptamos garantía de ANDA, Contaduría General de la Nación, seguro de alquiler (Porto, Sura, Mapfre) y depósito en el BHU. Te ayudamos con el trámite.",
  },
  {
    question: "¿Qué documentación necesito para alquilar?",
    keywords: ["documentacion", "documentos", "papeles", "requisitos", "necesito para alquilar"],
    answer:
      "Cédula de identidad, comprobante de ingresos de los últimos 3 meses y la garantía elegida. Si sos extranjero, también documento vigente.",
  },
  {
    question: "¿Cuánto cobran de comisión?",
    keywords: ["comision", "honorarios", "cobran", "porcentaje"],
    answer:
      "En compraventas el honorario habitual es del 3 % + IVA para cada parte; en alquileres, un mes de alquiler + IVA. Consultanos por tu caso.",
  },
  {
    question: "¿Hacen tasaciones?",
    keywords: ["tasacion", "tasar", "cuanto vale", "valor de mi", "vender mi"],
    answer:
      "Sí, tasamos sin costo con un estudio de comparables de la zona. Dejanos tus datos y coordinamos una visita.",
  },
  {
    question: "¿Cómo coordino una visita?",
    keywords: ["visita", "visitar", "ver la propiedad", "coordinar", "conocer"],
    answer:
      "Decinos qué propiedad te interesa (por ejemplo «PROP-12») y tus datos de contacto, y un asesor te propone horarios.",
  },
];

export type BotAction =
  | { type: "start" }
  | { type: "message"; text: string }
  | {
      type: "search";
      operation: "sale" | "rent";
      propertyType?: string | null;
      maxPrice?: number | null;
    }
  | {
      type: "handoff";
      name: string;
      phone: string;
      email?: string | null;
      message?: string | null;
      propertyCode?: string | null;
      transcript?: string | null;
    };
