import { z } from "zod";
import { CURRENCIES, parseMoney } from "../money";
import { DEPOSIT_HOLDERS, OFFER_PARTIES, OFFER_RESPONSES, RESERVATION_CANCEL_OUTCOMES } from "../offers";
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

const amount = z.union([z.string(), z.number()]).transform((v) => String(v).trim());

function toMinor(
  v: string,
  currency: "UYU" | "USD",
  ctx: z.RefinementCtx,
  path: string,
  label: string,
): bigint {
  try {
    if (!v) throw new Error("vacío");
    const m = parseMoney(v, currency);
    if (m.amountMinor <= 0n) throw new Error("no positivo");
    return m.amountMinor;
  } catch {
    ctx.addIssue({ code: "custom", message: label, path: [path] });
    return 0n;
  }
}

export const createOfferSchema = z
  .object({
    dealId: uuidSchema,
    party: z.enum(OFFER_PARTIES).default("client"),
    currency: z.enum(CURRENCIES),
    amount,
    conditions: text(2000),
    validUntil: isoDate,
  })
  .transform((v, ctx) => ({
    ...v,
    amountMinor: toMinor(v.amount, v.currency, ctx, "amount", "Indicá el monto"),
  }));

export const respondOfferSchema = z
  .object({
    offerId: uuidSchema,
    response: z.enum(OFFER_RESPONSES),
    note: text(1000),
    /** Solo para contraofertar. */
    currency: z.enum(CURRENCIES).optional(),
    amount: amount.optional(),
    conditions: text(2000),
    validUntil: isoDate,
  })
  .transform((v, ctx) => ({
    ...v,
    amountMinor:
      v.response === "counter"
        ? toMinor(v.amount ?? "", v.currency ?? "USD", ctx, "amount", "Indicá el monto de la contraoferta")
        : null,
  }));

export const createReservationSchema = z
  .object({
    dealId: uuidSchema,
    currency: z.enum(CURRENCIES),
    deposit: amount,
    receivedAt: z.iso.date("Indicá la fecha"),
    expiresAt: z.iso.date("Indicá hasta cuándo vale"),
    holder: z.enum(DEPOSIT_HOLDERS).default("agency"),
    receiptNumber: text(60),
    notes: text(2000),
  })
  .transform((v, ctx) => {
    if (v.expiresAt < v.receivedAt)
      ctx.addIssue({ code: "custom", message: "El vencimiento es anterior al cobro", path: ["expiresAt"] });
    return {
      ...v,
      depositMinor: toMinor(v.deposit, v.currency, ctx, "deposit", "Indicá el monto de la seña"),
    };
  });

export const extendReservationSchema = z.object({
  reservationId: uuidSchema,
  expiresAt: z.iso.date("Indicá la nueva fecha"),
  note: text(500),
});

export const cancelReservationSchema = z
  .object({
    reservationId: uuidSchema,
    outcome: z.enum(RESERVATION_CANCEL_OUTCOMES),
    reason: z.string().trim().min(3, "Indicá el motivo").max(500),
    /** Vuelve a negociación (true) o la operación se cae (false). */
    backToNegotiation: z.boolean().default(false),
    refundedAt: isoDate,
  })
  .superRefine((v, ctx) => {
    if (v.outcome === "refunded" && !v.refundedAt)
      ctx.addIssue({ code: "custom", message: "Indicá cuándo se devolvió", path: ["refundedAt"] });
  });
