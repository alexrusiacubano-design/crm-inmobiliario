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

const notarySchema = z
  .object({
    name: z.string().trim().max(160).default(""),
    phone: z.string().trim().max(40).optional().nullable(),
    email: z.string().trim().max(200).optional().nullable(),
  })
  .optional()
  .nullable()
  .transform((v) =>
    v && (v.name || v.phone || v.email)
      ? { name: v.name, phone: v.phone || null, email: v.email || null }
      : null,
  );

const reservationFields = {
  currency: z.enum(CURRENCIES),
  /** Vacío = reserva sin seña. */
  deposit: amount.optional().default(""),
  receivedAt: z.iso.date("Indicá la fecha"),
  expiresAt: z.iso.date("Indicá hasta cuándo vale"),
  holder: z.enum(DEPOSIT_HOLDERS).default("agency"),
  receiptNumber: text(60),
  notes: text(2000),
  signingDate: isoDate,
  boletoSignedAt: isoDate,
  boletoExpiresAt: isoDate,
  shared: z.boolean().default(false),
  sharedWith: text(160),
  buyerNotary: notarySchema,
  sellerNotary: notarySchema,
};

function reservationTransform<
  T extends {
    deposit: string;
    currency: "UYU" | "USD";
    receivedAt: string;
    expiresAt: string;
    boletoSignedAt: string | null;
    boletoExpiresAt: string | null;
    shared: boolean;
    sharedWith: string | null;
  },
>(v: T, ctx: z.RefinementCtx) {
  if (v.expiresAt < v.receivedAt)
    ctx.addIssue({ code: "custom", message: "El vencimiento es anterior a la reserva", path: ["expiresAt"] });
  if (v.boletoSignedAt && v.boletoExpiresAt && v.boletoExpiresAt < v.boletoSignedAt)
    ctx.addIssue({ code: "custom", message: "Vence antes de la firma", path: ["boletoExpiresAt"] });
  return {
    ...v,
    sharedWith: v.shared ? v.sharedWith : null,
    depositMinor: v.deposit ? toMinor(v.deposit, v.currency, ctx, "deposit", "Monto de seña inválido") : 0n,
  };
}

export const createReservationSchema = z
  .object({ dealId: uuidSchema, ...reservationFields })
  .transform(reservationTransform);

export const updateReservationSchema = z
  .object({ reservationId: uuidSchema, ...reservationFields })
  .transform(reservationTransform);

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
