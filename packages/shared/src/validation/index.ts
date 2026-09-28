import { z } from "zod";
import { CURRENCIES } from "../money";
import { PERMISSION_CODES, SCOPES, type PermissionCode } from "../rbac/permissions";

/**
 * Esquemas Zod compartidos: los usa el formulario en el navegador y, sobre todo, el
 * servidor antes de tocar la base. El servidor NUNCA confía en la validación del cliente.
 */

const trimmed = (min: number, max: number, label: string) =>
  z
    .string()
    .trim()
    .min(min, `${label}: mínimo ${min} caracteres`)
    .max(max, `${label}: máximo ${max} caracteres`);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const uuidSchema = z.uuid("Identificador inválido");

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email("Email inválido"));

/** Política de contraseñas: largo antes que complejidad arbitraria. */
export const passwordSchema = z
  .string()
  .min(10, "La contraseña debe tener al menos 10 caracteres")
  .max(128, "La contraseña es demasiado larga")
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), "Debe incluir letras y números");

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
  q: z.string().trim().max(120).optional().catch(undefined),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

export const roleAssignmentSchema = z.object({
  roleId: uuidSchema,
  branchId: uuidSchema.nullable().default(null),
});

export const membershipStatusSchema = z.enum(["active", "suspended"]);

export const createUserSchema = z.object({
  name: trimmed(2, 120, "Nombre"),
  email: emailSchema,
  password: passwordSchema,
  jobTitle: optionalText(120),
  phone: optionalText(40),
  defaultBranchId: uuidSchema.nullable().default(null),
  roles: z.array(roleAssignmentSchema).min(1, "Asigná al menos un rol"),
  teamIds: z.array(uuidSchema).default([]),
});
export type CreateUserInput = z.input<typeof createUserSchema>;

export const updateUserSchema = z.object({
  membershipId: uuidSchema,
  name: trimmed(2, 120, "Nombre"),
  jobTitle: optionalText(120),
  phone: optionalText(40),
  defaultBranchId: uuidSchema.nullable().default(null),
  roles: z.array(roleAssignmentSchema).min(1, "Asigná al menos un rol"),
  teamIds: z.array(uuidSchema).default([]),
});
export type UpdateUserInput = z.input<typeof updateUserSchema>;

export const setMembershipStatusSchema = z.object({
  membershipId: uuidSchema,
  status: membershipStatusSchema,
});

export const resetPasswordSchema = z.object({
  membershipId: uuidSchema,
  password: passwordSchema,
});

export const branchSchema = z.object({
  name: trimmed(2, 80, "Nombre"),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,12}$/, "Código: 2 a 12 letras, números o guiones"),
  address: optionalText(200),
  phone: optionalText(40),
});
export const updateBranchSchema = branchSchema.extend({ id: uuidSchema, isActive: z.boolean() });

export const teamSchema = z.object({
  name: trimmed(2, 80, "Nombre"),
  branchId: uuidSchema,
  leadMembershipId: uuidSchema.nullable().default(null),
});
export const updateTeamSchema = teamSchema.extend({ id: uuidSchema, isActive: z.boolean() });

const permissionCodeSchema = z
  .string()
  .refine(
    (v): v is PermissionCode => (PERMISSION_CODES as readonly string[]).includes(v),
    "Permiso desconocido",
  );

export const roleGrantSchema = z.object({
  code: permissionCodeSchema,
  scope: z.enum(SCOPES),
});

export const roleSchema = z.object({
  name: trimmed(2, 60, "Nombre"),
  description: optionalText(240),
  grants: z.array(roleGrantSchema).max(PERMISSION_CODES.length),
});
export const updateRoleSchema = roleSchema.extend({ id: uuidSchema });

export const orgSettingsSchema = z.object({
  name: trimmed(2, 120, "Nombre"),
  defaultCurrency: z.enum(CURRENCIES),
  timezone: z.string().trim().min(3).max(64),
});

export const auditQuerySchema = listQuerySchema.extend({
  entityType: z.string().trim().max(60).optional().catch(undefined),
  action: z.string().trim().max(60).optional().catch(undefined),
  actorUserId: uuidSchema.optional().catch(undefined),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;
