/**
 * Publicaciones en portales y tipo de cambio (Fase 11).
 *
 * Los portales uruguayos (InfoCasas, Mercado Libre, Gallito) publican vía API de socios o feed;
 * el CRM lleva el estado de cada aviso, su nivel y vencimiento, y expone un feed XML por cuenta
 * para que el portal lo importe. Las credenciales de API de cada portal se cargan al conectarlo.
 */

export const PORTALS = ["infocasas", "mercadolibre", "gallito", "website", "other"] as const;
export type Portal = (typeof PORTALS)[number];
export const PORTAL_LABELS: Record<Portal, string> = {
  infocasas: "InfoCasas",
  mercadolibre: "Mercado Libre Inmuebles",
  gallito: "Gallito",
  website: "Sitio web propio",
  other: "Otro portal",
};

export const AD_LEVELS = ["basic", "silver", "gold", "premium"] as const;
export type AdLevel = (typeof AD_LEVELS)[number];
export const AD_LEVEL_LABELS: Record<AdLevel, string> = {
  basic: "Básico",
  silver: "Plata",
  gold: "Oro",
  premium: "Premium",
};

export const PUBLICATION_STATUSES = ["published", "paused", "expired", "removed"] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];
export const PUBLICATION_STATUS_LABELS: Record<PublicationStatus, string> = {
  published: "Publicado",
  paused: "Pausado",
  expired: "Vencido",
  removed: "Dado de baja",
};

export function canTransitionPublication(from: PublicationStatus, to: PublicationStatus): boolean {
  const allowed: Record<PublicationStatus, readonly PublicationStatus[]> = {
    published: ["paused", "expired", "removed"],
    paused: ["published", "removed"],
    expired: ["published", "removed"],
    removed: ["published"],
  };
  return allowed[from].includes(to);
}

export const PUBLICATION_EXPIRY_ALERT_DAYS = 7;

export type PublicationAlert = "expiring" | "expired" | "property_unavailable" | "no_url";
export const PUBLICATION_ALERT_LABELS: Record<PublicationAlert, string> = {
  expiring: "Vence pronto",
  expired: "Vencido: renovar o bajar",
  property_unavailable: "La propiedad ya no está disponible",
  no_url: "Falta el enlace del aviso",
};

const OFFERABLE = ["available", "published", "negotiating"];

export function publicationAlerts(
  p: { status: PublicationStatus; expiresAt: string | null; url: string | null; portal: Portal },
  propertyStatus: string,
  today: string,
): PublicationAlert[] {
  if (p.status !== "published") return [];
  const out: PublicationAlert[] = [];
  if (!OFFERABLE.includes(propertyStatus)) out.push("property_unavailable");
  if (p.expiresAt) {
    if (p.expiresAt < today) out.push("expired");
    else {
      const days = Math.round(
        (Date.UTC(+p.expiresAt.slice(0, 4), +p.expiresAt.slice(5, 7) - 1, +p.expiresAt.slice(8, 10)) -
          Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10))) /
          86_400_000,
      );
      if (days <= PUBLICATION_EXPIRY_ALERT_DAYS) out.push("expiring");
    }
  }
  if (!p.url && p.portal !== "website") out.push("no_url");
  return out;
}

export type LevelQuotas = Partial<Record<AdLevel, number>>;

/** Lugares libres por nivel según el plan contratado (sin cupo cargado = ilimitado). */
export function quotaLeft(
  quotas: LevelQuotas,
  used: Partial<Record<AdLevel, number>>,
  level: AdLevel,
): number | null {
  const q = quotas[level];
  if (q === undefined || q === null) return null;
  return q - (used[level] ?? 0);
}

// ─── Tipo de cambio ─────────────────────────────────────────────────────────

export const EXCHANGE_SOURCES = ["manual", "bcu"] as const;
export type ExchangeSource = (typeof EXCHANGE_SOURCES)[number];
export const EXCHANGE_SOURCE_LABELS: Record<ExchangeSource, string> = { manual: "Carga manual", bcu: "BCU" };

/** Código BCU del dólar estadounidense billete. */
export const BCU_USD_CODE = 2225;

/** Cuerpo SOAP para pedir cotizaciones al web service del BCU. */
export function bcuRequestXml(from: string, to: string, currencyCode = BCU_USD_CODE): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cot="Cotiza">
  <soapenv:Header/>
  <soapenv:Body>
    <cot:wsbcucotizaciones.Execute>
      <cot:Entrada>
        <cot:Moneda><cot:item>${currencyCode}</cot:item></cot:Moneda>
        <cot:FechaDesde>${from}</cot:FechaDesde>
        <cot:FechaHasta>${to}</cot:FechaHasta>
        <cot:Grupo>0</cot:Grupo>
      </cot:Entrada>
    </cot:wsbcucotizaciones.Execute>
  </soapenv:Body>
</soapenv:Envelope>`;
}

/**
 * Lee la respuesta del BCU: devuelve la última cotización (fecha y valor de venta, o compra si
 * no hay venta) como texto decimal. null si la respuesta no trae datos.
 */
export function parseBcuResponse(xml: string): { date: string; rate: string } | null {
  const items = [
    ...xml.matchAll(
      /<(?:\w+:)?datoscotizaciones\.dato\b[^>]*>([\s\S]*?)<\/(?:\w+:)?datoscotizaciones\.dato>/gi,
    ),
  ];
  const blocks = items.length ? items.map((m) => m[1] ?? "") : [xml];
  const pick = (block: string, tag: string) =>
    block.match(new RegExp(`<(?:\\w+:)?${tag}>\\s*([^<\\s]+)\\s*</(?:\\w+:)?${tag}>`, "i"))?.[1] ?? null;
  let best: { date: string; rate: string } | null = null;
  for (const b of blocks) {
    const date = pick(b, "Fecha");
    const rate = pick(b, "TCV") ?? pick(b, "TCC");
    if (!date || !rate || Number(rate) <= 0) continue;
    const ymd = date.slice(0, 10);
    if (!best || ymd > best.date) best = { date: ymd, rate };
  }
  return best;
}

/** "40,25" o "40.25" → "40.2500" (4 decimales) o null si es inválido. */
export function normalizeRate(input: string): string | null {
  const raw = input.trim().replace(",", ".");
  if (!/^\d{1,4}(\.\d{1,4})?$/.test(raw)) return null;
  const [i = "0", d = ""] = raw.split(".");
  const n = Number(raw);
  if (!(n > 0)) return null;
  return `${Number(i)}.${(d + "0000").slice(0, 4)}`;
}

// ─── Credenciales de portales ───────────────────────────────────────────────

export interface CredentialField {
  key: string;
  label: string;
  /** Secreto: se guarda cifrado y no se vuelve a mostrar completo. */
  secret: boolean;
  placeholder?: string;
  hint?: string;
}

/**
 * Datos de conexión que pide cada portal (se cargan desde Integraciones, nunca en el código).
 * Mercado Libre usa OAuth: con App ID y clave secreta de tu aplicación se hace "Conectar".
 */
export const PORTAL_CREDENTIAL_FIELDS: Record<Portal, readonly CredentialField[]> = {
  infocasas: [
    { key: "agencyId", label: "Código de inmobiliaria", secret: false },
    {
      key: "apiKey",
      label: "Clave de la API",
      secret: true,
      hint: "Se la pedís a tu comercial de InfoCasas.",
    },
  ],
  gallito: [
    { key: "agencyId", label: "Código de inmobiliaria", secret: false },
    { key: "apiKey", label: "Clave de la API", secret: true, hint: "Se la pedís a tu comercial de Gallito." },
  ],
  mercadolibre: [
    {
      key: "appId",
      label: "App ID",
      secret: false,
      hint: "De tu aplicación en developers.mercadolibre.com.uy.",
    },
    { key: "clientSecret", label: "Clave secreta (Secret Key)", secret: true },
  ],
  website: [],
  other: [
    { key: "apiUrl", label: "Dirección de la API", secret: false, placeholder: "https://" },
    { key: "apiKey", label: "Clave de la API", secret: true },
  ],
};

/** "abcd…wxyz" → "••••wxyz" para mostrar que hay un secreto guardado sin revelarlo. */
export function maskSecret(v: string): string {
  return v.length <= 4 ? "••••" : `••••${v.slice(-4)}`;
}

/** Nivel del aviso → tipo de publicación de Mercado Libre. */
export const ML_LISTING_TYPES: Record<AdLevel, string> = {
  basic: "silver",
  silver: "silver",
  gold: "gold",
  premium: "gold_premium",
};
