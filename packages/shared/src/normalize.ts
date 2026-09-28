import type { DocumentType } from "./crm";

/**
 * Normalización de datos de contacto. Lo normalizado es lo que se compara para detectar
 * duplicados y lo que se indexa para la búsqueda; lo que el usuario escribió se conserva.
 */

/** Minúsculas y sin tildes: "Pérez Núñez" → "perez nunez". */
export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Teléfono a formato E.164 con reglas de Uruguay:
 * - "099 123 456" / "99123456" → +59899123456 (celular)
 * - "2710 1234" / "4222 1234" → +59827101234 (fijo)
 * - "+54 9 11 ..." o "0054..." se respetan como internacionales.
 * Devuelve null si no parece un teléfono.
 */
export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  let digits = onlyDigits(trimmed);
  if (digits.length < 7) return null;

  if (trimmed.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.startsWith("00")) {
    digits = digits.slice(2);
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (digits.startsWith("598") && (digits.length === 11 || digits.length === 12)) return `+${digits}`;
  // Celular uruguayo: 09X XXX XXX (9 dígitos) o 9X XXX XXX (8 dígitos).
  if (/^09\d{7}$/.test(digits)) return `+598${digits.slice(1)}`;
  if (/^9\d{7}$/.test(digits)) return `+598${digits}`;
  // Fijo uruguayo: 8 dígitos que empiezan con 2 (Montevideo) o 4 (interior).
  if (/^[24]\d{7}$/.test(digits)) return `+598${digits}`;
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Valida el dígito verificador de una cédula uruguaya (7 u 8 dígitos incluyendo el
 * verificador). Algoritmo oficial: pesos 2,9,8,7,6,3,4.
 */
export function isValidUruguayanCI(raw: string): boolean {
  const digits = onlyDigits(raw);
  if (digits.length < 7 || digits.length > 8) return false;
  const padded = digits.padStart(8, "0");
  const body = padded.slice(0, 7);
  const check = Number(padded[7]);
  const weights = [2, 9, 8, 7, 6, 3, 4];
  const total = weights.reduce((acc, w, i) => acc + w * Number(body[i]), 0);
  return (10 - (total % 10)) % 10 === check;
}

/** Normaliza el número de documento según su tipo (lo que se guarda y compara). */
export function normalizeDocument(type: DocumentType, raw: string): string {
  if (type === "ci" || type === "rut") return onlyDigits(raw);
  return raw.replace(/[\s.-]/g, "").toUpperCase();
}

/** "12345672" → "1.234.567-2" (formato habitual de la cédula). */
export function formatCI(normalized: string): string {
  const digits = onlyDigits(normalized);
  if (digits.length < 7) return normalized;
  const body = digits.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${body}-${digits.slice(-1)}`;
}

/** Enmascara dejando visibles los últimos `visible` caracteres. */
export function mask(value: string, visible = 4): string {
  if (value.length <= visible) return value;
  return `${"•".repeat(Math.min(8, value.length - visible))}${value.slice(-visible)}`;
}
