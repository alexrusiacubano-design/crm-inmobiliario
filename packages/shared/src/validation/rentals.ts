import { z } from "zod";
import { CURRENCIES, parseMoney, parsePercentToBasisPoints } from "../money";
import { ADJUSTMENT_INDEXES, CONTRACT_CLOSE_KINDS } from "../rentals";
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
const date = (msg: string) => z.iso.date(msg);
const amount = z.union([z.string(), z.number()]).transform((v) => String(v).trim());
const optionalText = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v) => (v === null || v === undefined ? "" : String(v).trim()));

function money(v: string, currency: "UYU" | "USD", ctx: z.RefinementCtx, path: string, required: boolean) {
  if (!v) {
    if (required) ctx.addIssue({ code: "custom", message: "Indicá el monto", path: [path] });
    return null;
  }
  try {
    const m = parseMoney(v, currency);
    if (m.amountMinor <= 0n) throw new Error("no positivo");
    return m.amountMinor;
  } catch {
    ctx.addIssue({ code: "custom", message: "Importe inválido", path: [path] });
    return null;
  }
}
function percent(v: string, ctx: z.RefinementCtx, path: string, allowNegative = false): number | null {
  if (!v) return null;
  try {
    const neg = allowNegative && v.startsWith("-");
    const bp = parsePercentToBasisPoints(neg ? v.slice(1) : v);
    return neg ? -bp : bp;
  } catch {
    ctx.addIssue({ code: "custom", message: "Porcentaje inválido", path: [path] });
    return null;
  }
}

export const createContractSchema = z
  .object({
    propertyId: uuidSchema,
    tenantContactId: uuidSchema,
    dealId: optionalUuid,
    startDate: date("Indicá el inicio"),
    months: z.coerce.number().int().min(1, "Mínimo 1 mes").max(240),
    currency: z.enum(CURRENCIES).default("UYU"),
    rent: amount,
    paymentDay: z.coerce.number().int().min(1).max(28).default(10),
    adjustmentIndex: z.enum(ADJUSTMENT_INDEXES).default("ipc"),
    adjustmentMonths: z.coerce.number().int().min(1).max(60).default(12),
    fixedAdjustmentPercent: optionalText,
    deposit: optionalText,
    depositCurrency: z.enum(CURRENCIES).optional(),
    adminFeePercent: optionalText,
    guaranteeNote: text(300),
    notes: text(4000),
    assignedUserId: optionalUuid,
  })
  .transform((v, ctx) => {
    const fixed = percent(v.fixedAdjustmentPercent, ctx, "fixedAdjustmentPercent");
    if (v.adjustmentIndex === "fixed" && fixed === null)
      ctx.addIssue({ code: "custom", message: "Indicá el porcentaje", path: ["fixedAdjustmentPercent"] });
    return {
      ...v,
      rentMinor: money(v.rent, v.currency, ctx, "rent", true) ?? 0n,
      fixedAdjustmentBasisPoints: v.adjustmentIndex === "fixed" ? fixed : null,
      depositMinor: money(v.deposit, v.depositCurrency ?? v.currency, ctx, "deposit", false),
      adminFeeBasisPoints: percent(v.adminFeePercent, ctx, "adminFeePercent"),
    };
  });

/** Ajuste: por porcentaje o indicando el nuevo monto. */
export const applyAdjustmentSchema = z
  .object({
    contractId: uuidSchema,
    effectiveFrom: date("Indicá desde cuándo"),
    percent: optionalText,
    newRent: optionalText,
    note: text(500),
  })
  .transform((v, ctx) => {
    const bp = percent(v.percent, ctx, "percent", true);
    if (bp === null && !v.newRent)
      ctx.addIssue({ code: "custom", message: "Indicá el porcentaje o el nuevo monto", path: ["percent"] });
    return { ...v, basisPoints: bp };
  });

export const renewContractSchema = z.object({
  contractId: uuidSchema,
  months: z.coerce.number().int().min(1).max(240),
  newRent: optionalText,
  note: text(500),
});

export const closeContractSchema = z.object({
  contractId: uuidSchema,
  kind: z.enum(CONTRACT_CLOSE_KINDS),
  date: date("Indicá la fecha"),
  reason: text(500),
});

export const contractListSchema = z.object({
  status: z.enum(["active", "expiring", "closed", "all"]).default("active"),
  q: text(100),
  propertyId: optionalUuid,
});
