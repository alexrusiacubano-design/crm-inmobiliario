import { z } from "zod";
import { EVENT_STATUSES, EVENT_TYPES, VISIT_OUTCOMES } from "../agenda";
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

/** Fecha y hora con zona (la calcula el navegador del usuario). */
const dateTime = z.iso
  .datetime({ offset: true, message: "Fecha y hora inválidas" })
  .transform((v) => new Date(v));

const optionalDateTime = z
  .union([z.literal(""), z.null(), dateTime])
  .optional()
  .transform((v) => (v instanceof Date ? v : null));

const eventFields = z.object({
  type: z.enum(EVENT_TYPES),
  title: z.string().trim().min(2, "Título: mínimo 2 caracteres").max(160, "Título: máximo 160 caracteres"),
  description: text(4000),
  location: text(240),
  startsAt: dateTime,
  endsAt: optionalDateTime,
  allDay: z.boolean().default(false),
  contactId: optionalUuid,
  leadId: optionalUuid,
  propertyId: optionalUuid,
  assignedUserId: optionalUuid,
});

function checkRange(
  v: { startsAt: Date; endsAt: Date | null; type: string; propertyId: string | null },
  ctx: z.RefinementCtx,
) {
  if (v.endsAt && v.endsAt < v.startsAt) {
    ctx.addIssue({ code: "custom", message: "La hora de fin es anterior al inicio", path: ["endsAt"] });
  }
  if (v.endsAt && v.endsAt.getTime() - v.startsAt.getTime() > 7 * 86_400_000) {
    ctx.addIssue({ code: "custom", message: "Un evento no puede durar más de 7 días", path: ["endsAt"] });
  }
  if (v.type === "visit" && !v.propertyId) {
    ctx.addIssue({ code: "custom", message: "Una visita necesita una propiedad", path: ["propertyId"] });
  }
}

export const createEventSchema = eventFields.superRefine(checkRange);
export type CreateEventInput = z.input<typeof createEventSchema>;

export const updateEventSchema = eventFields.extend({ id: uuidSchema }).superRefine(checkRange);

export const closeEventSchema = z.object({
  id: uuidSchema,
  status: z.enum(EVENT_STATUSES).exclude(["scheduled"]),
  outcome: z
    .enum(VISIT_OUTCOMES)
    .optional()
    .nullable()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  rating: z
    .union([z.literal(""), z.null(), z.coerce.number().int().min(1).max(5)])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v)),
  feedback: text(4000),
});

export const reopenEventSchema = z.object({ id: uuidSchema, startsAt: dateTime, endsAt: optionalDateTime });

export const eventListSchema = z.object({
  from: dateTime,
  to: dateTime,
  type: z.enum(EVENT_TYPES).optional().catch(undefined),
  status: z.enum(EVENT_STATUSES).optional().catch(undefined),
  assignedUserId: uuidSchema.optional().catch(undefined),
  contactId: uuidSchema.optional().catch(undefined),
  propertyId: uuidSchema.optional().catch(undefined),
});
