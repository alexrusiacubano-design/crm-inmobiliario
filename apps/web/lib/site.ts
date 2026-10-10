import { siteOrganization } from "@crm/core";
import { getDb } from "@crm/db";
import { cache } from "react";

/** Inmobiliaria dueña del sitio público (una vez por request). */
export const getSite = cache(async () => siteOrganization(getDb()));

/** Enlace de WhatsApp para un teléfono uruguayo ("099 123 456" → 59899123456). */
export function whatsappLink(phone: string | null | undefined, text: string): string | null {
  if (!phone) return null;
  let d = phone.replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = `598${d.slice(1)}`;
  else if (!d.startsWith("598") && d.length <= 9) d = `598${d}`;
  return `https://wa.me/${d}?text=${encodeURIComponent(text)}`;
}

export const photoUrl = (id: string, size: "thumb" | "full" = "full") =>
  `/api/sitio/foto/${id}${size === "thumb" ? "?t=thumb" : ""}`;
