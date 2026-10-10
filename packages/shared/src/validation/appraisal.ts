import { z } from "zod";
import { COMPARABLE_KINDS, COMPARISON_LEVELS } from "../appraisal";
import { PROPERTY_TYPES } from "../crm";
import { CURRENCIES } from "../money";
import { PROPERTY_CONDITIONS, PROPERTY_OPERATIONS } from "../property";
import { listQuerySchema, uuidSchema } from "./index";

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

/** "1.250,5" → 1250.5 · "120.000" → 120000 · "85.5" → 85.5 */
export function parseLocaleNumber(raw: string): number {
  const t = raw.trim().replace(/\s/g, "");
  if (t.includes(",")) return Number(t.replace(/\./g, "").replace(",", "."));
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ""));
  return Number(t);
}

/** Número opcional que acepta "1.250,5", "1250.5" o vacío. */
const num = (max = 1e12) =>
  z
    .union([z.number(), z.string()])
    .optional()
    .nullable()
    .transform((v, ctx) => {
      if (v === null || v === undefined || v === "") return null;
      const n = typeof v === "number" ? v : parseLocaleNumber(String(v));
      if (!Number.isFinite(n) || n < 0 || n > max) {
        ctx.addIssue({ code: "custom", message: "Número inválido" });
        return z.NEVER;
      }
      return n;
    });

const intOpt = (max: number) =>
  num(max).transform((v) => (v === null ? null : Math.round(v)));

const level = z.coerce
  .number()
  .int()
  .refine((v) => (COMPARISON_LEVELS as readonly number[]).includes(v), "Valor inválido")
  .transform((v) => v as (typeof COMPARISON_LEVELS)[number]);

export const appraisalComparableSchema = z.object({
  reference: z.string().trim().max(200).default(""),
  m2: num(1e7),
  construction: level.default(0),
  location: level.default(0),
  kind: z.enum(COMPARABLE_KINDS).default("offer"),
  price: num(1e12),
  url: text(500),
  sourceCode: text(30),
});

export const appraisalInputSchema = z.object({
  id: uuidSchema.optional().nullable(),
  title: text(200),
  address: text(300),
  propertyType: z.enum(PROPERTY_TYPES),
  operation: z.enum(PROPERTY_OPERATIONS).default("sale"),
  departmentId: z.coerce.number().int().positive().optional().nullable().catch(null),
  localityId: z.coerce.number().int().positive().optional().nullable().catch(null),
  neighborhoodId: z.coerce.number().int().positive().optional().nullable().catch(null),
  builtArea: num(1e7),
  totalArea: num(1e8),
  bedrooms: intOpt(50),
  bathrooms: intOpt(50),
  garages: intOpt(50),
  yearBuilt: intOpt(2100),
  condition: z.enum(PROPERTY_CONDITIONS).optional().nullable().catch(null),
  clientName: text(160),
  clientContactId: uuidSchema.optional().nullable().catch(null),
  currency: z.enum(CURRENCIES).default("USD"),
  offerDiscountBp: z.coerce.number().int().min(0).max(5000).default(700),
  comparables: z.array(appraisalComparableSchema).max(30).default([]),
  adoptedValue: num(1e12),
  notes: text(4000),
  status: z.enum(["draft", "final"]).default("draft"),
});
export type AppraisalInput = z.input<typeof appraisalInputSchema>;

export const appraisalListSchema = listQuerySchema.extend({
  status: z.enum(["draft", "final"]).optional().catch(undefined),
});

export const comparatorQuerySchema = z.object({
  operation: z.enum(PROPERTY_OPERATIONS).default("sale").catch("sale"),
  propertyType: z.enum(PROPERTY_TYPES).optional().catch(undefined),
  departmentId: z.coerce.number().int().positive().optional().catch(undefined),
  localityId: z.coerce.number().int().positive().optional().catch(undefined),
  neighborhoodId: z.coerce.number().int().positive().optional().catch(undefined),
  minArea: z.coerce.number().positive().optional().catch(undefined),
  maxArea: z.coerce.number().positive().optional().catch(undefined),
  bedrooms: z.coerce.number().int().min(0).max(20).optional().catch(undefined),
  currency: z.enum(CURRENCIES).default("USD").catch("USD"),
});
