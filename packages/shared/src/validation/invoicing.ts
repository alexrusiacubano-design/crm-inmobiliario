import { z } from "zod";
import { CURRENCIES } from "../money";
import { INVOICE_SOURCE_TYPES, RECEIVER_DOC_TYPES, isValidRut } from "../invoicing";
import { uuidSchema } from "./index";

const amount = z
  .string()
  .trim()
  .regex(/^\d{1,12}([.,]\d{1,2})?$/, "Monto inválido");

export const invoiceLineInputSchema = z.object({
  description: z.string().trim().min(2, "Describí el concepto").max(300),
  amount,
  sourceType: z.enum(INVOICE_SOURCE_TYPES).optional().nullable(),
  sourceId: uuidSchema.optional().nullable(),
});

export const createInvoiceSchema = z
  .object({
    contactId: uuidSchema.optional().nullable(),
    receiverName: z.string().trim().min(2, "Indicá a quién se factura").max(160),
    receiverDocType: z.enum(RECEIVER_DOC_TYPES),
    receiverDoc: z
      .string()
      .trim()
      .max(30)
      .optional()
      .nullable()
      .transform((v) => (v ? v.replace(/[\s.-]/g, "") : null)),
    receiverAddress: z
      .string()
      .trim()
      .max(200)
      .optional()
      .nullable()
      .transform((v) => v || null),
    currency: z.enum(CURRENCIES),
    taxIncluded: z.boolean().default(false),
    notes: z
      .string()
      .trim()
      .max(1000)
      .optional()
      .nullable()
      .transform((v) => v || null),
    lines: z.array(invoiceLineInputSchema).min(1, "Agregá al menos un concepto").max(30),
  })
  .superRefine((v, ctx) => {
    if (v.receiverDocType === "rut" && (!v.receiverDoc || !isValidRut(v.receiverDoc)))
      ctx.addIssue({ code: "custom", path: ["receiverDoc"], message: "RUT inválido (12 dígitos)" });
    if (v.receiverDocType === "ci" && v.receiverDoc && !/^\d{6,8}$/.test(v.receiverDoc))
      ctx.addIssue({ code: "custom", path: ["receiverDoc"], message: "Cédula inválida" });
  });

export const issueInvoiceSchema = z.object({
  id: uuidSchema,
  cfeSeries: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{1,2}$/, "Serie: 1 o 2 letras"),
  cfeNumber: z.coerce.number().int().min(1, "Número inválido").max(9_999_999),
  issuedAt: z.iso.date("Fecha inválida"),
});

export const voidInvoiceSchema = z.object({
  id: uuidSchema,
  reason: z.string().trim().min(3, "Indicá el motivo").max(300),
});
