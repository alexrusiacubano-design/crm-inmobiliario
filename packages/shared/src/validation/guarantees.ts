import { z } from "zod";
import { DEPOSIT_PLACES, GUARANTEE_STATUSES, GUARANTEE_TYPES } from "../guarantees";
import { CURRENCIES, parseMoney } from "../money";
import { uuidSchema } from "./index";

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
const isoDate = z
  .union([z.literal(""), z.null(), z.iso.date("Fecha inválida")])
  .optional()
  .transform((v) => (v ? v : null));
const optionalText = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v) => (v === null || v === undefined ? "" : String(v).trim()));

const fields = {
  type: z.enum(GUARANTEE_TYPES),
  provider: text(120),
  reference: text(80),
  currency: z.enum(CURRENCIES).default("UYU"),
  coverage: optionalText,
  validFrom: isoDate,
  validUntil: isoDate,
  depositPlace: z.enum(DEPOSIT_PLACES).optional().nullable(),
  guarantorContactId: optionalUuid,
  notes: text(2000),
};

function withMoney<
  T extends {
    coverage: string;
    currency: "UYU" | "USD";
    validFrom: string | null;
    validUntil: string | null;
  },
>(v: T, ctx: z.RefinementCtx) {
  let coverageMinor: bigint | null = null;
  if (v.coverage) {
    try {
      coverageMinor = parseMoney(v.coverage, v.currency).amountMinor;
      if (coverageMinor <= 0n) throw new Error("no positivo");
    } catch {
      ctx.addIssue({ code: "custom", message: "Importe inválido", path: ["coverage"] });
    }
  }
  if (v.validFrom && v.validUntil && v.validUntil < v.validFrom)
    ctx.addIssue({ code: "custom", message: "Termina antes de empezar", path: ["validUntil"] });
  return { ...v, coverageMinor };
}

export const createGuaranteeSchema = z
  .object({
    tenantContactId: uuidSchema,
    contractId: optionalUuid,
    dealId: optionalUuid,
    ...fields,
  })
  .transform(withMoney);

export const updateGuaranteeSchema = z.object({ id: uuidSchema, ...fields }).transform(withMoney);

export const guaranteeStatusSchema = z.object({
  id: uuidSchema,
  status: z.enum(GUARANTEE_STATUSES),
  note: text(500),
  contractId: optionalUuid,
});

export const guaranteeRequirementSchema = z.object({
  id: uuidSchema,
  index: z.number().int().min(0).max(30),
  done: z.boolean(),
  /** Para agregar un requisito nuevo (index se ignora). */
  label: text(120),
});

export const guaranteeListSchema = z.object({
  status: z.enum(["in_process", "active", "alerts", "closed", "all"]).default("all"),
  type: z.enum(GUARANTEE_TYPES).optional().nullable(),
  contractId: optionalUuid,
  tenantContactId: optionalUuid,
});
