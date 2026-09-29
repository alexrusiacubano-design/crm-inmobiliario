import { z } from "zod";
import { MATCH_STATUSES } from "../matching";
import { PROPERTY_TYPES } from "../crm";
import { PROPERTY_OPERATIONS } from "../property";
import { uuidSchema } from "./index";

export const setMatchStatusSchema = z.object({
  matchId: uuidSchema,
  status: z.enum(MATCH_STATUSES),
  note: z
    .string()
    .trim()
    .max(500)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
});

/** Búsqueda de comparables: por propiedad existente o por datos sueltos (captación). */
export const comparablesQuerySchema = z
  .object({
    propertyId: uuidSchema.optional().nullable(),
    type: z.enum(PROPERTY_TYPES).optional().nullable(),
    operation: z.enum(PROPERTY_OPERATIONS).default("sale"),
    localityId: z.coerce.number().int().positive().optional().nullable(),
    neighborhoodId: z.coerce.number().int().positive().optional().nullable(),
    areaM2: z.coerce.number().positive().max(100_000).optional().nullable(),
    bedrooms: z.coerce.number().int().min(0).max(50).optional().nullable(),
    limit: z.coerce.number().int().min(1).max(20).default(8),
  })
  .refine((q) => q.propertyId || q.type, { message: "Indicá la propiedad o el tipo", path: ["type"] });
