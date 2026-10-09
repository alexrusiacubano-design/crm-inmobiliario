import { z } from "zod";
import {
  AD_LEVELS,
  PORTAL_CREDENTIAL_FIELDS,
  PORTALS,
  PUBLICATION_STATUSES,
  normalizeRate,
} from "../publications";
import { uuidSchema } from "./index";

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));
const isoDate = z
  .union([z.literal(""), z.null(), z.iso.date("Fecha inválida")])
  .optional()
  .transform((v) => (v ? v : null));
const url = z
  .union([z.literal(""), z.null(), z.url("Enlace inválido").max(500)])
  .optional()
  .transform((v) => (v ? v : null));
const count = z.coerce.number().int().min(0).max(10_000_000).optional().nullable();

export const portalAccountSchema = z.object({
  portal: z.enum(PORTALS),
  enabled: z.boolean(),
  accountRef: text(120),
  quotas: z.partialRecord(z.enum(AD_LEVELS), z.coerce.number().int().min(0).max(10_000)).default({}),
});

export const portalCredentialsSchema = z
  .object({
    portal: z.enum(PORTALS),
    /** Valores nuevos. Un secreto vacío conserva el guardado. */
    values: z.record(z.string(), z.string().trim().max(500)),
  })
  .superRefine((v, ctx) => {
    const allowed = new Set(PORTAL_CREDENTIAL_FIELDS[v.portal].map((f) => f.key));
    for (const k of Object.keys(v.values))
      if (!allowed.has(k))
        ctx.addIssue({ code: "custom", path: ["values", k], message: "Campo desconocido" });
    const url = v.values.apiUrl;
    if (url && !/^https:\/\//.test(url))
      ctx.addIssue({ code: "custom", path: ["values", "apiUrl"], message: "Tiene que empezar con https://" });
  });

export const publishSchema = z.object({
  propertyId: uuidSchema,
  portal: z.enum(PORTALS),
  level: z.enum(AD_LEVELS).default("basic"),
  externalId: text(80),
  url,
  expiresAt: isoDate,
  notes: text(500),
});

export const publicationUpdateSchema = z.object({
  id: uuidSchema,
  level: z.enum(AD_LEVELS),
  externalId: text(80),
  url,
  expiresAt: isoDate,
  views: count,
  contacts: count,
  notes: text(500),
});

export const publicationStatusSchema = z.object({
  id: uuidSchema,
  status: z.enum(PUBLICATION_STATUSES),
});

export const exchangeRateSchema = z.object({
  date: z.iso.date("Indicá la fecha"),
  rate: z
    .string()
    .trim()
    .transform((v, ctx) => {
      const r = normalizeRate(v);
      if (!r) ctx.addIssue({ code: "custom", message: "Tipo de cambio inválido" });
      return r ?? "0";
    }),
});
