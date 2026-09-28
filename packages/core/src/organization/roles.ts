import { and, asc, count, eq, isNull } from "drizzle-orm";
import { membershipRole, newId, role, rolePermission, type Db, type DbOrTx } from "@crm/db";
import { SCOPE_RANK, getPermissionDef, widestScope, type PermissionCode, type Scope } from "@crm/shared/rbac";
import { roleSchema, updateRoleSchema, uuidSchema } from "@crm/shared/validation";
import { writeAudit } from "../audit";
import { requirePermission, type RequestContext } from "../context";
import { ConflictError, ForbiddenError, NotFoundError, isUniqueViolation, parseInput } from "../errors";
import { emitEvent } from "../events";

export async function listRoles(db: DbOrTx, ctx: RequestContext) {
  const roles = await db
    .select({
      id: role.id,
      key: role.key,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      isLocked: role.isLocked,
    })
    .from(role)
    .where(and(eq(role.organizationId, ctx.organizationId), isNull(role.deletedAt)))
    .orderBy(asc(role.isSystem), asc(role.name));

  const [grantCounts, memberCounts] = await Promise.all([
    db
      .select({ roleId: rolePermission.roleId, n: count() })
      .from(rolePermission)
      .innerJoin(role, eq(role.id, rolePermission.roleId))
      .where(eq(role.organizationId, ctx.organizationId))
      .groupBy(rolePermission.roleId),
    db
      .select({ roleId: membershipRole.roleId, n: count() })
      .from(membershipRole)
      .where(eq(membershipRole.organizationId, ctx.organizationId))
      .groupBy(membershipRole.roleId),
  ]);

  return roles.map((r) => ({
    ...r,
    permissionCount: grantCounts.find((g) => g.roleId === r.id)?.n ?? 0,
    memberCount: memberCounts.find((m) => m.roleId === r.id)?.n ?? 0,
  }));
}

export async function getRole(db: DbOrTx, ctx: RequestContext, roleId: string) {
  const id = parseInput(uuidSchema, roleId);
  const [r] = await db
    .select()
    .from(role)
    .where(and(eq(role.id, id), eq(role.organizationId, ctx.organizationId), isNull(role.deletedAt)));
  if (!r) throw new NotFoundError("Rol");
  const grants = await db
    .select({ code: rolePermission.permissionCode, scope: rolePermission.scope })
    .from(rolePermission)
    .where(eq(rolePermission.roleId, id))
    .orderBy(asc(rolePermission.permissionCode));
  return { ...r, grants };
}

/**
 * Normaliza grants: los permisos no-scopables siempre en "org". Además impide la escalada de
 * privilegios: nadie puede otorgar un permiso que no tiene, ni con un alcance mayor al suyo.
 */
function normalizeGrants(ctx: RequestContext, grants: readonly { code: PermissionCode; scope: Scope }[]) {
  const merged = new Map<PermissionCode, Scope>();
  for (const g of grants) {
    const scope: Scope = getPermissionDef(g.code).scopable ? g.scope : "org";
    const own = widestScope(ctx.grants, g.code);
    if (!own || SCOPE_RANK[own] < SCOPE_RANK[scope]) {
      throw new ForbiddenError(
        `No podés otorgar "${getPermissionDef(g.code).label}" con un alcance mayor al tuyo`,
      );
    }
    merged.set(g.code, scope);
  }
  return [...merged.entries()].map(([code, scope]) => ({ code, scope }));
}

async function writeGrants(tx: DbOrTx, roleId: string, grants: { code: PermissionCode; scope: Scope }[]) {
  await tx.delete(rolePermission).where(eq(rolePermission.roleId, roleId));
  if (grants.length) {
    await tx
      .insert(rolePermission)
      .values(grants.map((g) => ({ roleId, permissionCode: g.code, scope: g.scope })));
  }
}

export async function createRole(db: Db, ctx: RequestContext, rawInput: unknown) {
  requirePermission(ctx, "roles.manage");
  const input = parseInput(roleSchema, rawInput);
  const grants = normalizeGrants(ctx, input.grants);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(role)
        .values({
          organizationId: ctx.organizationId,
          key: `custom_${newId().slice(-12)}`,
          name: input.name,
          description: input.description ?? null,
        })
        .returning();
      if (!row) throw new Error("No se pudo crear el rol");
      await writeGrants(tx, row.id, grants);
      await writeAudit(tx, ctx, {
        action: "role.create",
        entityType: "role",
        entityId: row.id,
        after: { ...row, grants },
      });
      await emitEvent(tx, ctx, { type: "role.created", aggregateType: "role", aggregateId: row.id });
      return row;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError("Ya existe un rol con esa clave");
    throw error;
  }
}

export async function updateRole(db: Db, ctx: RequestContext, rawInput: unknown) {
  requirePermission(ctx, "roles.manage");
  const input = parseInput(updateRoleSchema, rawInput);
  const grants = normalizeGrants(ctx, input.grants);

  return db.transaction(async (tx) => {
    const before = await getRole(tx, ctx, input.id);
    if (before.isLocked) throw new ForbiddenError("Este rol está bloqueado y no se puede modificar");
    await tx
      .update(role)
      .set({ name: input.name, description: input.description ?? null })
      .where(eq(role.id, input.id));
    await writeGrants(tx, input.id, grants);
    const after = await getRole(tx, ctx, input.id);
    await writeAudit(tx, ctx, {
      action: "permission.role_change",
      entityType: "role",
      entityId: input.id,
      before: { name: before.name, description: before.description, grants: before.grants },
      after: { name: after.name, description: after.description, grants: after.grants },
    });
    await emitEvent(tx, ctx, { type: "role.updated", aggregateType: "role", aggregateId: input.id });
    return after;
  });
}

export async function deleteRole(db: Db, ctx: RequestContext, roleId: string) {
  requirePermission(ctx, "roles.manage");
  return db.transaction(async (tx) => {
    const before = await getRole(tx, ctx, roleId);
    if (before.isSystem) throw new ForbiddenError("Los roles de sistema no se eliminan; podés editarlos");
    const [usage] = await tx
      .select({ n: count() })
      .from(membershipRole)
      .where(eq(membershipRole.roleId, before.id));
    if ((usage?.n ?? 0) > 0)
      throw new ConflictError("El rol está asignado a usuarios. Quitá las asignaciones primero.");
    // Baja lógica: el rol queda para la auditoría histórica.
    await tx.update(role).set({ deletedAt: new Date() }).where(eq(role.id, before.id));
    await writeAudit(tx, ctx, { action: "role.delete", entityType: "role", entityId: before.id, before });
    await emitEvent(tx, ctx, { type: "role.deleted", aggregateType: "role", aggregateId: before.id });
  });
}
