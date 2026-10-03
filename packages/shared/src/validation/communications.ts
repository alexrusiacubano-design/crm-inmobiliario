import { z } from "zod";
import { unknownVariables, INQUIRY_CHANNELS, TEMPLATE_CHANNELS } from "../communications";
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

export const createInquirySchema = z
  .object({
    channel: z.enum(INQUIRY_CHANNELS).default("web"),
    name: text(120),
    phone: text(40),
    email: z
      .union([z.literal(""), z.null(), z.email("Email inválido")])
      .optional()
      .transform((v) => (v ? v.toLowerCase() : null)),
    message: z.string().trim().min(2, "Escribí la consulta").max(4000),
    propertyId: optionalUuid,
    propertyCode: text(30),
    externalRef: text(120),
  })
  .superRefine((v, ctx) => {
    if (!v.phone && !v.email)
      ctx.addIssue({ code: "custom", message: "Indicá un teléfono o email", path: ["phone"] });
  });

export const inquiryActionSchema = z.object({
  id: uuidSchema,
  action: z.enum(["take", "assign", "resolve", "reject", "reopen"]),
  assignedUserId: optionalUuid,
  note: text(1000),
});

export const convertInquirySchema = z.object({
  id: uuidSchema,
  operation: z.enum(["buy", "rent", "temporary_rent"]),
});

export const chatStartSchema = z.object({
  memberIds: z.array(uuidSchema).min(1, "Elegí al menos una persona").max(30),
  title: text(80),
});

export const chatMessageSchema = z.object({
  conversationId: uuidSchema,
  body: z.string().trim().min(1, "Escribí un mensaje").max(4000),
});

export const templateSchema = z
  .object({
    id: optionalUuid,
    name: z.string().trim().min(2, "Poné un nombre").max(80),
    channel: z.enum(TEMPLATE_CHANNELS),
    subject: text(200),
    body: z.string().trim().min(2, "Escribí el texto").max(4000),
    active: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    const bad = unknownVariables(`${v.subject ?? ""} ${v.body}`);
    if (bad.length)
      ctx.addIssue({ code: "custom", message: `Variables desconocidas: ${bad.join(", ")}`, path: ["body"] });
  });

export const logOutboundSchema = z.object({
  contactId: uuidSchema,
  leadId: optionalUuid,
  channel: z.enum(TEMPLATE_CHANNELS),
  templateId: optionalUuid,
  body: z.string().trim().min(1).max(4000),
  subject: text(200),
});
