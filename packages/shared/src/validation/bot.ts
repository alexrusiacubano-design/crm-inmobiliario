import { z } from "zod";

const str = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const botFaqSchema = z.object({
  question: z.string().trim().min(3, "Escribí la pregunta").max(160),
  keywords: z
    .union([z.string(), z.array(z.string())])
    .transform((v) =>
      (Array.isArray(v) ? v : v.split(","))
        .map((k) => k.trim())
        .filter(Boolean)
        .slice(0, 15),
    )
    .refine((v) => v.length > 0, { message: "Agregá al menos una palabra clave" }),
  answer: z.string().trim().min(3, "Escribí la respuesta").max(800),
});

export const botSettingsSchema = z.object({
  enabled: z.boolean(),
  greeting: z.string().trim().min(3, "Escribí el saludo").max(400),
  handoffMessage: z.string().trim().min(3, "Escribí el mensaje").max(400),
  faqs: z.array(botFaqSchema).max(40),
});

export const botActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start") }),
  z.object({ type: z.literal("message"), text: z.string().trim().min(1).max(500) }),
  z.object({
    type: z.literal("search"),
    operation: z.enum(["sale", "rent"]),
    propertyType: str(30),
    maxPrice: z.coerce.number().int().min(0).max(100_000_000).optional().nullable(),
  }),
  z.object({
    type: z.literal("handoff"),
    name: z.string().trim().min(2, "Decinos tu nombre").max(120),
    phone: z.string().trim().min(6, "Dejanos un teléfono").max(40),
    email: z
      .union([z.literal(""), z.null(), z.email("Email inválido").max(200)])
      .optional()
      .transform((v) => (v ? v : null)),
    message: str(1000),
    propertyCode: str(20),
    transcript: str(4000),
  }),
]);
