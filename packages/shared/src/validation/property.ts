import { z } from "zod";
import { PORTALS } from "../publications";
import { PROPERTY_FEATURES, PROPERTY_TYPES } from "../crm";
import { CURRENCIES, parseMoney, parsePercentToBasisPoints } from "../money";
import {
  ACQUISITION_STAGES,
  DOCUMENT_CATEGORIES,
  DOCUMENT_STATUSES,
  DOCUMENT_VISIBILITIES,
  EXPENSE_KINDS,
  EXPENSE_PERIODS,
  ORIENTATIONS,
  PROPERTY_CONDITIONS,
  PROPERTY_OPERATIONS,
  PROPERTY_STATUSES,
  VALUATION_METHODS,
} from "../property";
import { listQuerySchema, uuidSchema } from "./index";

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

const optionalUuid = uuidSchema
  .optional()
  .nullable()
  .or(z.literal(""))
  .transform((v) => (v ? v : null));

const optionalInt = (min: number, max: number) =>
  z
    .union([z.literal(""), z.null(), z.coerce.number().int().min(min).max(max)])
    .optional()
    .transform((v) => (v === "" || v === undefined || v === null ? null : v));

/** Número decimal positivo (superficies, coordenadas) escrito con coma o punto. */
const optionalDecimal = (min: number, max: number, decimals: number) =>
  z
    .union([z.literal(""), z.null(), z.number(), z.string()])
    .optional()
    .transform((v, ctx) => {
      if (v === "" || v === null || v === undefined) return null;
      const s = String(v).trim().replace(",", ".");
      if (!new RegExp(`^-?\\d+(\\.\\d{1,${decimals}})?$`).test(s)) {
        ctx.addIssue({ code: "custom", message: "Número inválido" });
        return z.NEVER;
      }
      const n = Number(s);
      if (n < min || n > max) {
        ctx.addIssue({ code: "custom", message: `Debe estar entre ${min} y ${max}` });
        return z.NEVER;
      }
      return s;
    });

/** Importe como texto; se convierte a unidad menor en el servicio (nunca float). */
const moneyText = z
  .string()
  .trim()
  .max(20)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => {
    if (v === null) return true;
    try {
      return parseMoney(v, "USD").amountMinor >= 0n;
    } catch {
      return false;
    }
  }, "Importe inválido");

const percentText = z
  .string()
  .trim()
  .max(8)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => {
    if (v === null) return true;
    try {
      parsePercentToBasisPoints(v);
      return true;
    } catch {
      return false;
    }
  }, "Porcentaje inválido (ej.: 3 o 3,5)");

const isoDate = z
  .string()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Fecha inválida");

export const expenseInputSchema = z.object({
  kind: z.enum(EXPENSE_KINDS),
  label: text(80),
  amount: moneyText.refine((v) => v !== null, "Indicá el importe"),
  currency: z.enum(CURRENCIES).default("UYU"),
  period: z.enum(EXPENSE_PERIODS).default("monthly"),
});

export const propertyInputSchema = z
  .object({
    type: z.enum(PROPERTY_TYPES),
    operations: z.array(z.enum(PROPERTY_OPERATIONS)).min(1, "Elegí al menos una operación").max(3),
    title: text(140),
    description: text(8000),
    departmentId: optionalInt(1, 100_000),
    localityId: optionalInt(1, 1_000_000),
    neighborhoodId: optionalInt(1, 1_000_000),
    address: text(200),
    unit: text(40),
    /** N.º de padrón (catastro) */
    padron: text(30),
    latitude: optionalDecimal(-90, 90, 6),
    longitude: optionalDecimal(-180, 180, 6),
    bedrooms: optionalInt(0, 50),
    bathrooms: optionalInt(0, 50),
    suites: optionalInt(0, 50),
    garages: optionalInt(0, 50),
    totalArea: optionalDecimal(0, 10_000_000, 2),
    builtArea: optionalDecimal(0, 1_000_000, 2),
    floor: text(20),
    yearBuilt: optionalInt(1800, 2100),
    orientation: z
      .enum(ORIENTATIONS)
      .optional()
      .nullable()
      .or(z.literal(""))
      .transform((v) => (v ? v : null)),
    condition: z
      .enum(PROPERTY_CONDITIONS)
      .optional()
      .nullable()
      .or(z.literal(""))
      .transform((v) => (v ? v : null)),
    features: z.array(z.enum(PROPERTY_FEATURES)).max(PROPERTY_FEATURES.length).default([]),
    petsAllowed: z.boolean().default(false),
    furnished: z.boolean().default(false),
    commissionPercent: percentText,
    assignedUserId: optionalUuid,
    internalNotes: text(4000),
    expenses: z.array(expenseInputSchema).max(10).default([]),
  })
  .superRefine((p, ctx) => {
    if (p.suites !== null && p.bathrooms !== null && p.suites > p.bathrooms) {
      ctx.addIssue({ code: "custom", message: "Las suites no pueden superar los baños", path: ["suites"] });
    }
    if (p.totalArea && p.builtArea && Number(p.builtArea) > Number(p.totalArea) && p.type !== "apartment") {
      ctx.addIssue({
        code: "custom",
        message: "La superficie construida supera la total",
        path: ["builtArea"],
      });
    }
    if ((p.latitude === null) !== (p.longitude === null)) {
      ctx.addIssue({ code: "custom", message: "Indicá latitud y longitud", path: ["latitude"] });
    }
  });
export type PropertyInput = z.input<typeof propertyInputSchema>;

export const updatePropertySchema = z.object({ id: uuidSchema }).and(propertyInputSchema);

export const priceInputSchema = z
  .object({
    operation: z.enum(PROPERTY_OPERATIONS),
    currency: z.enum(CURRENCIES),
    list: moneyText,
    ownerAsking: moneyText,
    minimum: moneyText,
  })
  .superRefine((p, ctx) => {
    if (
      p.minimum &&
      p.list &&
      parseMoney(p.minimum, p.currency).amountMinor > parseMoney(p.list, p.currency).amountMinor
    ) {
      ctx.addIssue({
        code: "custom",
        message: "El mínimo autorizado supera el precio publicado",
        path: ["minimum"],
      });
    }
  });

export const setPricesSchema = z.object({
  propertyId: uuidSchema,
  prices: z.array(priceInputSchema).min(1).max(3),
  reason: text(300),
});

export const setOwnersSchema = z
  .object({
    propertyId: uuidSchema,
    owners: z
      .array(
        z.object({
          contactId: uuidSchema,
          sharePercent: percentText.refine((v) => v !== null, "Indicá el porcentaje"),
        }),
      )
      .max(20),
  })
  .superRefine((v, ctx) => {
    const ids = v.owners.map((o) => o.contactId);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: "custom", message: "Un propietario está repetido", path: ["owners"] });
    if (v.owners.length) {
      const total = v.owners.reduce(
        (acc, o) => acc + (o.sharePercent ? parsePercentToBasisPoints(o.sharePercent) : 0),
        0,
      );
      if (total !== 10_000) {
        ctx.addIssue({ code: "custom", message: "Las participaciones deben sumar 100 %", path: ["owners"] });
      }
    }
  });

export const propertyStatusSchema = z.object({
  propertyId: uuidSchema,
  status: z.enum(PROPERTY_STATUSES),
  note: text(500),
});

export const reorderMediaSchema = z.object({
  propertyId: uuidSchema,
  orderedIds: z.array(uuidSchema).min(1).max(200),
});

export const mediaUpdateSchema = z.object({
  mediaId: uuidSchema,
  caption: text(200),
  kind: z.enum(["photo", "floor_plan"]).optional(),
});

/** Solo enlaces a plataformas de video conocidas; no se aloja video en el CRM. */
export const videoLinkSchema = z.object({
  propertyId: uuidSchema,
  url: z
    .string()
    .trim()
    .url("URL inválida")
    .refine(
      (u) => /^https:\/\/(www\.)?(youtube\.com|youtu\.be|vimeo\.com|player\.vimeo\.com)\//.test(u),
      "Solo enlaces de YouTube o Vimeo",
    ),
  caption: text(200),
});

export const propertyListSchema = listQuerySchema.extend({
  status: z
    .enum([...PROPERTY_STATUSES, "active"])
    .optional()
    .catch(undefined),
  operation: z.enum(PROPERTY_OPERATIONS).optional().catch(undefined),
  type: z.enum(PROPERTY_TYPES).optional().catch(undefined),
  localityId: z.coerce.number().int().positive().optional().catch(undefined),
  assignedUserId: uuidSchema.optional().catch(undefined),
  ownerContactId: uuidSchema.optional().catch(undefined),
});
export type PropertyListQuery = z.infer<typeof propertyListSchema>;

export const acquisitionInputSchema = z
  .object({
    ownerContactId: uuidSchema,
    propertyId: optionalUuid,
    propertyType: z.enum(PROPERTY_TYPES),
    operation: z.enum(PROPERTY_OPERATIONS),
    address: text(200),
    padron: text(30),
    localityId: optionalInt(1, 1_000_000),
    neighborhoodId: optionalInt(1, 1_000_000),
    latitude: optionalDecimal(-90, 90, 6),
    longitude: optionalDecimal(-180, 180, 6),
    /** De dónde salió la captación (portal donde estaba publicada) y su aviso. */
    sourcePortal: z
      .enum(PORTALS)
      .optional()
      .nullable()
      .or(z.literal(""))
      .transform((v) => (v ? v : null)),
    portalUrl: z
      .union([z.literal(""), z.null(), z.url("Enlace inválido").max(500)])
      .optional()
      .transform((v) => (v ? v : null)),
    captadorUserId: optionalUuid,
    exclusive: z.boolean().default(false),
    exclusiveFrom: isoDate,
    exclusiveUntil: isoDate,
    commissionPercent: percentText,
    currency: z.enum(CURRENCIES).default("USD"),
    askingPrice: moneyText,
    recommendedPrice: moneyText,
    publicationAuthorized: z.boolean().default(false),
    notes: text(4000),
  })
  .superRefine((a, ctx) => {
    if (a.exclusive && (!a.exclusiveFrom || !a.exclusiveUntil)) {
      ctx.addIssue({
        code: "custom",
        message: "Indicá inicio y vencimiento de la exclusividad",
        path: ["exclusiveUntil"],
      });
    }
    if (a.exclusiveFrom && a.exclusiveUntil && a.exclusiveUntil < a.exclusiveFrom) {
      ctx.addIssue({
        code: "custom",
        message: "El vencimiento es anterior al inicio",
        path: ["exclusiveUntil"],
      });
    }
  });

export const updateAcquisitionSchema = z.object({ id: uuidSchema }).and(acquisitionInputSchema);

export const acquisitionStageSchema = z
  .object({
    id: uuidSchema,
    stage: z.enum(ACQUISITION_STAGES),
    lostReason: text(300),
  })
  .superRefine((v, ctx) => {
    if (v.stage === "lost" && !v.lostReason)
      ctx.addIssue({ code: "custom", message: "Indicá el motivo", path: ["lostReason"] });
  });

export const acquisitionListSchema = listQuerySchema.extend({
  stage: z
    .enum([...ACQUISITION_STAGES, "open"])
    .optional()
    .catch(undefined),
});

export const valuationInputSchema = z
  .object({
    propertyId: optionalUuid,
    acquisitionId: optionalUuid,
    method: z.enum(VALUATION_METHODS),
    currency: z.enum(CURRENCIES).default("USD"),
    value: moneyText.refine((v) => v !== null, "Indicá el valor"),
    min: moneyText,
    max: moneyText,
    valuedAt: isoDate.refine((v) => v !== null, "Indicá la fecha"),
    comparables: z
      .array(
        z.object({
          address: z.string().trim().min(3).max(200),
          price: moneyText.refine((v) => v !== null, "Precio"),
          areaM2: optionalDecimal(0, 1_000_000, 2),
          url: z
            .string()
            .trim()
            .url()
            .max(500)
            .optional()
            .nullable()
            .or(z.literal(""))
            .transform((v) => (v ? v : null)),
        }),
      )
      .max(20)
      .default([]),
    notes: text(4000),
  })
  .superRefine((v, ctx) => {
    if (!v.propertyId && !v.acquisitionId) {
      ctx.addIssue({
        code: "custom",
        message: "La tasación debe asociarse a una propiedad o captación",
        path: ["propertyId"],
      });
    }
    if (
      v.min &&
      v.max &&
      parseMoney(v.min, v.currency).amountMinor > parseMoney(v.max, v.currency).amountMinor
    ) {
      ctx.addIssue({ code: "custom", message: "El mínimo supera al máximo", path: ["max"] });
    }
  });

export const documentMetaSchema = z.object({
  entityType: z.enum(["property", "contact"]),
  entityId: uuidSchema,
  category: z.enum(DOCUMENT_CATEGORIES),
  type: z.string().trim().min(2, "Indicá el tipo de documento").max(80),
  name: z.string().trim().min(2).max(160),
  expiresAt: isoDate,
  visibility: z.enum(DOCUMENT_VISIBILITIES).default("internal"),
  status: z.enum(DOCUMENT_STATUSES).default("valid"),
});

export const updateDocumentSchema = z.object({
  id: uuidSchema,
  type: z.string().trim().min(2).max(80),
  name: z.string().trim().min(2).max(160),
  expiresAt: isoDate,
  visibility: z.enum(DOCUMENT_VISIBILITIES),
  status: z.enum(DOCUMENT_STATUSES),
});

export const documentListSchema = listQuerySchema.extend({
  category: z.enum(DOCUMENT_CATEGORIES).optional().catch(undefined),
  status: z.enum(DOCUMENT_STATUSES).optional().catch(undefined),
  expiring: z
    .union([z.literal("1"), z.boolean()])
    .optional()
    .catch(undefined)
    .transform((v) => v === "1" || v === true),
});
