import { z } from "zod";
import {
  CHANNEL_TYPES,
  CONTACT_KINDS,
  DOCUMENT_TYPES,
  INTERACTION_TYPES,
  LEAD_LOST_REASONS,
  LEAD_OPERATIONS,
  LEAD_SOURCES,
  RELATION_TYPES,
  LEAD_STATUSES,
  PROPERTY_FEATURES,
  PROPERTY_TYPES,
} from "../crm";
import { CURRENCIES, parseMoney } from "../money";
import { isValidUruguayanCI, normalizeEmail, normalizePhone, onlyDigits } from "../normalize";
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

const optionalInt = (min: number, max: number) =>
  z
    .union([z.literal(""), z.null(), z.coerce.number().int().min(min).max(max)])
    .optional()
    .transform((v) => (v === "" || v === undefined || v === null ? null : v));

/** Importe decimal como texto ("230.000", "1.234,50"): se convierte a unidad menor en el servicio. */
const moneyText = z
  .string()
  .trim()
  .max(20)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => {
    if (v === null) return true;
    try {
      parseMoney(v, "USD");
      return true;
    } catch {
      return false;
    }
  }, "Importe inválido");

export const channelInputSchema = z
  .object({
    type: z.enum(CHANNEL_TYPES),
    value: z.string().trim().min(3, "Dato de contacto demasiado corto").max(120),
    label: text(40),
    isPrimary: z.boolean().default(false),
  })
  .superRefine((c, ctx) => {
    if (c.type === "email" && !z.email().safeParse(normalizeEmail(c.value)).success) {
      ctx.addIssue({ code: "custom", message: "Email inválido", path: ["value"] });
    }
    if (c.type !== "email" && !normalizePhone(c.value)) {
      ctx.addIssue({ code: "custom", message: "Teléfono inválido", path: ["value"] });
    }
  });
export type ChannelInput = z.output<typeof channelInputSchema>;

export const contactInputSchema = z
  .object({
    kind: z.enum(CONTACT_KINDS).default("person"),
    firstName: text(80),
    lastName: text(80),
    companyName: text(160),
    documentType: z
      .enum(DOCUMENT_TYPES)
      .optional()
      .nullable()
      .or(z.literal(""))
      .transform((v) => (v ? v : null)),
    documentNumber: text(30),
    nationality: text(60),
    address: text(200),
    departmentId: optionalInt(1, 100_000),
    localityId: optionalInt(1, 1_000_000),
    notes: text(4000),
    assignedUserId: optionalUuid,
    branchId: optionalUuid,
    channels: z.array(channelInputSchema).max(10).default([]),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  })
  .superRefine((c, ctx) => {
    if (c.kind === "person" && !c.firstName) {
      ctx.addIssue({ code: "custom", message: "El nombre es obligatorio", path: ["firstName"] });
    }
    if (c.kind === "company" && !c.companyName) {
      ctx.addIssue({ code: "custom", message: "La razón social es obligatoria", path: ["companyName"] });
    }
    if (c.documentNumber && !c.documentType) {
      ctx.addIssue({ code: "custom", message: "Indicá el tipo de documento", path: ["documentType"] });
    }
    if (c.documentType === "ci" && c.documentNumber && !isValidUruguayanCI(c.documentNumber)) {
      ctx.addIssue({
        code: "custom",
        message: "Cédula inválida (dígito verificador)",
        path: ["documentNumber"],
      });
    }
    if (c.documentType === "rut" && c.documentNumber && onlyDigits(c.documentNumber).length !== 12) {
      ctx.addIssue({ code: "custom", message: "El RUT tiene 12 dígitos", path: ["documentNumber"] });
    }
    if (c.channels.filter((ch) => ch.isPrimary && ch.type === "email").length > 1) {
      ctx.addIssue({ code: "custom", message: "Solo un email principal", path: ["channels"] });
    }
  });
export type ContactInput = z.input<typeof contactInputSchema>;

export const updateContactSchema = z.object({ id: uuidSchema }).and(contactInputSchema);

export const searchProfileSchema = z
  .object({
    operation: z.enum(LEAD_OPERATIONS),
    propertyTypes: z.array(z.enum(PROPERTY_TYPES)).max(PROPERTY_TYPES.length).default([]),
    departmentIds: z.array(z.coerce.number().int().positive()).max(19).default([]),
    localityIds: z.array(z.coerce.number().int().positive()).max(50).default([]),
    neighborhoodIds: z.array(z.coerce.number().int().positive()).max(100).default([]),
    currency: z.enum(CURRENCIES).default("USD"),
    priceMin: moneyText,
    priceMax: moneyText,
    bedroomsMin: optionalInt(0, 20),
    bathroomsMin: optionalInt(0, 20),
    garagesMin: optionalInt(0, 10),
    areaMin: optionalInt(0, 100_000),
    commonExpensesMax: moneyText,
    commonExpensesCurrency: z.enum(CURRENCIES).default("UYU"),
    pets: z.boolean().default(false),
    furnished: z.enum(["any", "yes", "no"]).default("any"),
    features: z.array(z.enum(PROPERTY_FEATURES)).max(PROPERTY_FEATURES.length).default([]),
    targetDate: z
      .string()
      .optional()
      .nullable()
      .transform((v) => (v ? v : null))
      .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Fecha inválida"),
    notes: text(2000),
  })
  .superRefine((s, ctx) => {
    if (s.priceMin && s.priceMax) {
      const min = parseMoney(s.priceMin, s.currency).amountMinor;
      const max = parseMoney(s.priceMax, s.currency).amountMinor;
      if (min > max)
        ctx.addIssue({ code: "custom", message: "El mínimo supera al máximo", path: ["priceMax"] });
    }
  });
export type SearchProfileInput = z.input<typeof searchProfileSchema>;

export const createLeadSchema = z
  .object({
    contactId: optionalUuid,
    contact: contactInputSchema.optional().nullable(),
    operation: z.enum(LEAD_OPERATIONS),
    source: z.enum(LEAD_SOURCES),
    assignedUserId: optionalUuid,
    branchId: optionalUuid,
    notes: text(4000),
    search: searchProfileSchema.optional().nullable(),
  })
  .superRefine((l, ctx) => {
    if (!l.contactId && !l.contact) {
      ctx.addIssue({ code: "custom", message: "Elegí un contacto o cargá uno nuevo", path: ["contactId"] });
    }
  });
export type CreateLeadInput = z.input<typeof createLeadSchema>;

export const changeLeadStatusSchema = z
  .object({
    leadId: uuidSchema,
    status: z.enum(LEAD_STATUSES),
    lostReason: z.enum(LEAD_LOST_REASONS).optional().nullable(),
    note: text(2000),
  })
  .superRefine((v, ctx) => {
    if (v.status === "lost" && !v.lostReason) {
      ctx.addIssue({ code: "custom", message: "Indicá el motivo de pérdida", path: ["lostReason"] });
    }
  });

export const assignLeadSchema = z.object({ leadId: uuidSchema, assignedUserId: uuidSchema });

export const saveSearchProfileSchema = z.object({ leadId: uuidSchema, search: searchProfileSchema });

export const interactionSchema = z
  .object({
    contactId: optionalUuid,
    leadId: optionalUuid,
    type: z.enum(INTERACTION_TYPES),
    direction: z.enum(["inbound", "outbound"]).optional().nullable(),
    body: z.string().trim().min(1, "Escribí un detalle").max(4000),
    occurredAt: z
      .string()
      .optional()
      .nullable()
      .transform((v) => (v ? new Date(v) : null))
      .refine(
        (d) => d === null || (!Number.isNaN(d.getTime()) && d.getTime() <= Date.now() + 60_000),
        "Fecha inválida",
      ),
  })
  .superRefine((v, ctx) => {
    if (!v.contactId && !v.leadId)
      ctx.addIssue({ code: "custom", message: "Falta el contacto", path: ["contactId"] });
  });

/** Campo opcional que distingue "no enviado" (undefined, no se toca) de "vacío" (null, se borra). */
const patchText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v ? v : null));

export const ownerProfileSchema = z.object({
  contactId: uuidSchema,
  authorizationNotes: text(2000),
  bankName: patchText(80),
  accountHolder: patchText(160),
  /** Vacío o ausente = no cambiar el número guardado. */
  accountNumber: patchText(40),
  accountCurrency: z.enum(CURRENCIES).nullable().optional(),
});

export const mergeContactsSchema = z
  .object({ survivorId: uuidSchema, mergedId: uuidSchema })
  .refine((v) => v.survivorId !== v.mergedId, "No se puede fusionar un contacto consigo mismo");

export const CLIENT_STATES = ["active", "closed", "discarded", "all"] as const;
export type ClientState = (typeof CLIENT_STATES)[number];

export const contactListSchema = listQuerySchema.extend({
  role: z.enum(["all", "client", "owner"]).catch("all").default("all"),
  /** Solo con role=client: activo (lead abierto), cerrado (ganado), descartado (todo perdido). */
  state: z.enum(CLIENT_STATES).catch("active").default("active"),
  source: z.enum(LEAD_SOURCES).optional().catch(undefined),
  operation: z.enum(LEAD_OPERATIONS).optional().catch(undefined),
  tag: z.string().trim().max(40).optional().catch(undefined),
  assignedUserId: uuidSchema.optional().catch(undefined),
});
export type ContactListQuery = z.infer<typeof contactListSchema>;

export const leadListSchema = listQuerySchema.extend({
  status: z
    .enum([...LEAD_STATUSES, "open"])
    .optional()
    .catch(undefined),
  operation: z.enum(LEAD_OPERATIONS).optional().catch(undefined),
  assignedUserId: uuidSchema.optional().catch(undefined),
  unattended: z
    .union([z.literal("1"), z.literal("true"), z.boolean()])
    .optional()
    .catch(undefined)
    .transform((v) => v === "1" || v === "true" || v === true),
});
export type LeadListQuery = z.infer<typeof leadListSchema>;

export const globalSearchSchema = z.object({ q: z.string().trim().min(2).max(80) });

export const contactDateSchema = z.object({
  contactId: uuidSchema,
  label: z.string().trim().min(2, "Descripción: mínimo 2 caracteres").max(80),
  date: z.iso.date("Fecha inválida"),
  /** Se repite todos los años (cumpleaños, aniversario de compra…). */
  yearly: z.boolean().default(false),
});

export const contactRelationSchema = z
  .object({
    contactId: uuidSchema,
    relatedContactId: uuidSchema,
    type: z.enum(RELATION_TYPES),
    note: z
      .string()
      .trim()
      .max(200)
      .optional()
      .nullable()
      .transform((v) => (v ? v : null)),
  })
  .refine((v) => v.contactId !== v.relatedContactId, {
    message: "No se puede vincular un contacto consigo mismo",
    path: ["relatedContactId"],
  });
