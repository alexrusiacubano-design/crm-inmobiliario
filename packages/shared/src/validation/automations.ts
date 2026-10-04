import { z } from "zod";
import {
  AUTOMATION_TRIGGER_KEYS,
  AUTOMATION_TRIGGERS,
  AUTOMATION_VARIABLES,
  CONDITION_OPS,
  ENTITY_FIELDS,
  actionAllowed,
  isSafeWebhookUrl,
  type AutomationTrigger,
} from "../automations";
import { uuidSchema } from "./index";

const line = (max: number, msg: string) => z.string().trim().min(1, msg).max(max);

function unknownVars(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g)) {
    const k = (m[1] ?? "").toLowerCase();
    if (!(k in AUTOMATION_VARIABLES)) out.push(k);
  }
  return out;
}
const templated = (max: number, msg: string) =>
  line(max, msg).refine((v) => unknownVars(v).length === 0, {
    message: `Variable desconocida. Usá: ${Object.keys(AUTOMATION_VARIABLES)
      .map((k) => `{{${k}}}`)
      .join(", ")}`,
  });

const recipient = {
  to: z.enum(["assignee", "role", "user"]),
  roleKey: z.string().trim().max(60).optional().nullable(),
  userId: uuidSchema.optional().nullable(),
};

export const automationActionSchema = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("notify"),
      ...recipient,
      title: templated(140, "Escribí el título"),
      body: z
        .string()
        .trim()
        .max(600)
        .optional()
        .nullable()
        .transform((v) => v || null)
        .refine((v) => !v || unknownVars(v).length === 0, { message: "Variable desconocida" }),
    }),
    z.object({
      type: z.literal("task"),
      to: z.enum(["assignee", "user"]),
      userId: uuidSchema.optional().nullable(),
      title: templated(140, "Escribí el título de la tarea"),
      dueInDays: z.coerce.number().int().min(0).max(90).default(1),
    }),
    z.object({
      type: z.literal("assign"),
      userIds: z.array(uuidSchema).min(1, "Elegí al menos un usuario").max(30),
    }),
    z.object({ type: z.literal("tag"), tag: line(40, "Escribí la etiqueta") }),
    z.object({
      type: z.literal("webhook"),
      url: z
        .string()
        .trim()
        .max(500)
        .refine(isSafeWebhookUrl, { message: "Usá una dirección https pública" }),
    }),
  ])
  .superRefine((a, ctx) => {
    if ((a.type === "notify" || a.type === "task") && a.to === "user" && !a.userId)
      ctx.addIssue({ code: "custom", path: ["userId"], message: "Elegí el usuario" });
    if (a.type === "notify" && a.to === "role" && !a.roleKey)
      ctx.addIssue({ code: "custom", path: ["roleKey"], message: "Elegí el rol" });
  });
export type AutomationAction = z.output<typeof automationActionSchema>;

export const automationConditionSchema = z.object({
  field: z.string().trim().min(1).max(40),
  op: z.enum(CONDITION_OPS),
  value: z.union([z.string().max(80), z.number(), z.boolean()]),
});

export const automationRuleSchema = z
  .object({
    id: uuidSchema.optional().nullable(),
    name: line(100, "Poné un nombre"),
    enabled: z.boolean().default(true),
    trigger: z.enum(AUTOMATION_TRIGGER_KEYS as [AutomationTrigger, ...AutomationTrigger[]]),
    days: z.coerce.number().int().min(0).max(365).optional().nullable(),
    conditions: z.array(automationConditionSchema).max(10).default([]),
    actions: z.array(automationActionSchema).min(1, "Agregá al menos una acción").max(6),
  })
  .superRefine((r, ctx) => {
    const t = AUTOMATION_TRIGGERS[r.trigger];
    const fields = ENTITY_FIELDS[t.entity];
    r.conditions.forEach((c, i) => {
      const f = fields.find((x) => x.key === c.field);
      if (!f) ctx.addIssue({ code: "custom", path: ["conditions", i, "field"], message: "Campo no válido" });
      else if (f.type === "number" && !Number.isFinite(Number(c.value)))
        ctx.addIssue({ code: "custom", path: ["conditions", i, "value"], message: "Indicá un número" });
      else if (f.type === "enum" && !f.options?.includes(String(c.value)))
        ctx.addIssue({ code: "custom", path: ["conditions", i, "value"], message: "Valor no válido" });
    });
    r.actions.forEach((a, i) => {
      if (!actionAllowed(a.type, t.entity))
        ctx.addIssue({
          code: "custom",
          path: ["actions", i, "type"],
          message: "Esta acción no aplica a este disparador",
        });
    });
    if (t.kind === "schedule" && (r.days === null || r.days === undefined))
      ctx.addIssue({ code: "custom", path: ["days"], message: "Indicá los días" });
  });
export type AutomationRuleInput = z.output<typeof automationRuleSchema>;
