import { z } from "zod";
import { CHARGE_LINE_KINDS, PAYMENT_METHODS } from "../billing";
import { parseMoney } from "../money";
import { uuidSchema } from "./index";

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));
const amount = z.union([z.string(), z.number()]).transform((v) => String(v).trim());
const period = z
  .string()
  .regex(/^\d{4}-\d{2}(-01)?$/, "Período inválido")
  .transform((v) => `${v.slice(0, 7)}-01`);

export const generateChargesSchema = z.object({ period });

export const chargeLineSchema = z.object({
  chargeId: uuidSchema,
  kind: z.enum(CHARGE_LINE_KINDS),
  description: text(200),
  amount,
});

export const registerPaymentSchema = z.object({
  chargeId: uuidSchema,
  amount,
  paidAt: z.iso.date("Indicá la fecha"),
  method: z.enum(PAYMENT_METHODS).default("transfer"),
  reference: text(80),
});

export const voidPaymentSchema = z.object({
  paymentId: uuidSchema,
  reason: z.string().trim().min(3, "Indicá el motivo").max(300),
});

export const chargeListSchema = z.object({
  period: period.optional(),
  status: z.enum(["all", "open", "overdue", "paid"]).default("all"),
  contractId: uuidSchema.optional(),
});

export const createSettlementSchema = z.object({
  chargeId: uuidSchema,
  deductions: z
    .array(z.object({ description: z.string().trim().min(2, "Describí el descuento").max(200), amount }))
    .max(20)
    .default([]),
  notes: text(1000),
});

export const settlementStatusSchema = z.object({
  id: uuidSchema,
  status: z.enum(["approved", "paid", "voided"]),
  paidAt: z
    .union([z.literal(""), z.null(), z.iso.date()])
    .optional()
    .transform((v) => (v ? v : null)),
  reference: text(80),
  reason: text(300),
});

/** Convierte un importe escrito a unidad menor (positivo). */
export function amountToMinor(v: string, currency: "UYU" | "USD"): bigint {
  const m = parseMoney(v, currency).amountMinor;
  if (m <= 0n) throw new Error("no positivo");
  return m;
}
