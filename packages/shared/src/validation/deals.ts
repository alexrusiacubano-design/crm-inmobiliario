import { z } from "zod";
import { COMMISSION_SIDES, DEAL_STAGES, PARTICIPANT_ROLES } from "../deals";
import { CURRENCIES, parseMoney, parsePercentToBasisPoints } from "../money";
import { PROPERTY_OPERATIONS } from "../property";
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

const isoDate = z
  .union([z.literal(""), z.null(), z.iso.date("Fecha inválida")])
  .optional()
  .transform((v) => (v ? v : null));

/** Importe escrito por una persona ("230.000", "1234,50") → unidad menor. */
const amount = z.union([z.string(), z.number()]).transform((v) => String(v).trim());

function toMinor(v: string, currency: "UYU" | "USD", ctx: z.RefinementCtx, path: string): bigint | null {
  if (!v) return null;
  try {
    const m = parseMoney(v, currency);
    if (m.amountMinor < 0n) throw new Error("negativo");
    return m.amountMinor;
  } catch {
    ctx.addIssue({ code: "custom", message: "Importe inválido", path: [path] });
    return null;
  }
}

export const createDealSchema = z
  .object({
    propertyId: uuidSchema,
    operation: z.enum(PROPERTY_OPERATIONS),
    clientContactId: uuidSchema,
    leadId: optionalUuid,
    currency: z.enum(CURRENCIES).default("USD"),
    price: amount,
    expectedCloseDate: isoDate,
    notes: text(4000),
    assignedUserId: optionalUuid,
  })
  .transform((v, ctx) => {
    const priceMinor = toMinor(v.price, v.currency, ctx, "price");
    if (priceMinor === null)
      ctx.addIssue({ code: "custom", message: "Indicá el precio acordado", path: ["price"] });
    return { ...v, priceMinor: priceMinor ?? 0n };
  });

export const updateDealSchema = z
  .object({
    id: uuidSchema,
    currency: z.enum(CURRENCIES),
    price: amount,
    expectedCloseDate: isoDate,
    notes: text(4000),
  })
  .transform((v, ctx) => {
    const priceMinor = toMinor(v.price, v.currency, ctx, "price");
    if (priceMinor === null)
      ctx.addIssue({ code: "custom", message: "Indicá el precio acordado", path: ["price"] });
    return { ...v, priceMinor: priceMinor ?? 0n };
  });

export const dealStageSchema = z
  .object({
    id: uuidSchema,
    stage: z.enum(DEAL_STAGES),
    note: text(1000),
    fallenReason: text(300),
    closedAt: isoDate,
  })
  .superRefine((v, ctx) => {
    if (v.stage === "fallen" && !v.fallenReason)
      ctx.addIssue({ code: "custom", message: "Indicá por qué se cayó", path: ["fallenReason"] });
  });

export const dealCommissionsSchema = z
  .object({
    dealId: uuidSchema,
    lines: z
      .array(
        z.object({
          side: z.enum(COMMISSION_SIDES),
          currency: z.enum(CURRENCIES),
          amount,
          dueDate: isoDate,
        }),
      )
      .max(COMMISSION_SIDES.length),
  })
  .transform((v, ctx) => {
    const seen = new Set<string>();
    const lines = v.lines
      .map((l, i) => {
        if (seen.has(l.side))
          ctx.addIssue({ code: "custom", message: "Un honorario por parte", path: ["lines", i, "side"] });
        seen.add(l.side);
        return { ...l, amountMinor: toMinor(l.amount, l.currency, ctx, `lines.${i}.amount`) };
      })
      .filter((l): l is typeof l & { amountMinor: bigint } => l.amountMinor !== null && l.amountMinor > 0n);
    return { dealId: v.dealId, lines };
  });

export const collectCommissionSchema = z.object({
  commissionId: uuidSchema,
  collectedAt: z.iso.date("Fecha inválida"),
  reference: text(120),
});

export const dealParticipantsSchema = z
  .object({
    dealId: uuidSchema,
    participants: z
      .array(
        z.object({
          userId: uuidSchema,
          role: z.enum(PARTICIPANT_ROLES),
          share: z.string().trim().min(1, "Indicá el porcentaje"),
        }),
      )
      .min(1, "Indicá al menos un participante")
      .max(10),
  })
  .transform((v, ctx) => {
    const participants = v.participants.map((p, i) => {
      let shareBasisPoints = 0;
      try {
        shareBasisPoints = parsePercentToBasisPoints(p.share);
      } catch {
        ctx.addIssue({ code: "custom", message: "Porcentaje inválido", path: ["participants", i, "share"] });
      }
      return { userId: p.userId, role: p.role, shareBasisPoints };
    });
    const total = participants.reduce((a, p) => a + p.shareBasisPoints, 0);
    if (total !== 10_000)
      ctx.addIssue({ code: "custom", message: "Los porcentajes deben sumar 100 %", path: ["participants"] });
    const ids = new Set(participants.map((p) => p.userId));
    if (ids.size !== participants.length)
      ctx.addIssue({ code: "custom", message: "Cada persona una sola vez", path: ["participants"] });
    return { dealId: v.dealId, participants };
  });

export const dealListSchema = listQuerySchema.extend({
  status: z.enum(["open", "closed", "fallen", "all"]).catch("open").default("open"),
  operation: z.enum(PROPERTY_OPERATIONS).optional().catch(undefined),
  mine: z
    .union([z.literal("1"), z.boolean()])
    .optional()
    .catch(undefined)
    .transform((v) => v === true || v === "1"),
});

export const commissionTierSchema = z.object({
  tiers: z
    .array(
      z.object({
        name: z.string().trim().min(2).max(40),
        minBilled: z.string().trim(),
        rate: z.string().trim(),
      }),
    )
    .min(1)
    .max(10),
  uyuPerUsd: z.string().trim(),
});
