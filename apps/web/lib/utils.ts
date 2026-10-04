import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const dateTimeFormatter = new Intl.DateTimeFormat("es-UY", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Montevideo",
});

export function formatDateTime(value: Date | string): string {
  // Node y el navegador pueden usar espacios distintos (U+202F, U+00A0) según su versión de ICU:
  // se normalizan para que el HTML del servidor coincida con el del cliente.
  return dateTimeFormatter
    .format(typeof value === "string" ? new Date(value) : value)
    .replace(/[\u202f\u00a0]/g, " ");
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Enlace de WhatsApp para un teléfono. Acepta E.164 ("+59899123456") o formato local
 * uruguayo ("099 123 456"). Devuelve null si no parece un celular.
 */
export function whatsappLink(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("09") && digits.length === 9) digits = `598${digits.slice(1)}`;
  else if (digits.startsWith("9") && digits.length === 8) digits = `598${digits}`;
  if (digits.length < 10 || digits.length > 15) return null;
  return `https://wa.me/${digits}`;
}

/** "hace 5 min", "hace 3 h", "ayer" o la fecha (calcular en el servidor para evitar desajustes). */
export function relativeLabel(value: Date, now = new Date()): string {
  const min = Math.floor((now.getTime() - value.getTime()) / 60_000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  if (min < 24 * 60) return `hace ${Math.floor(min / 60)} h`;
  if (min < 48 * 60) return "ayer";
  return formatDateTime(value);
}
