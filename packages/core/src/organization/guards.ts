import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { branch, membership, membershipRole, role, team, type DbOrTx } from "@crm/db";
import type { RequestContext } from "../context";
import { ConflictError, ForbiddenError, ValidationError } from "../errors";

/** Verifica que todos los ids pertenezcan a la organización. Evita referencias cruzadas entre tenants. */
export async function loadRolesInOrg(tx: DbOrTx, organizationId: string, roleIds: readonly string[]) {
  const unique = [...new Set(roleIds)];
  if (unique.length === 0) return [];
  const rows = await tx
    .select({ id: role.id, key: role.key, isLocked: role.isLocked, name: role.name })
    .from(role)
    .where(and(eq(role.organizationId, organizationId), inArray(role.id, unique), isNull(role.deletedAt)));
  if (rows.length !== unique.length)
    throw new ValidationError("Uno de los roles no existe", { roles: ["Rol inválido"] });
  return rows;
}

export async function assertBranchesInOrg(
  tx: DbOrTx,
  organizationId: string,
  branchIds: readonly (string | null)[],
) {
  const unique = [...new Set(branchIds.filter((b): b is string => !!b))];
  if (unique.length === 0) return;
  const rows = await tx
    .select({ id: branch.id })
    .from(branch)
    .where(
      and(eq(branch.organizationId, organizationId), inArray(branch.id, unique), isNull(branch.deletedAt)),
    );
  if (rows.length !== unique.length)
    throw new ValidationError("Sucursal inválida", { branchId: ["Sucursal inválida"] });
}

export async function assertTeamsInOrg(tx: DbOrTx, organizationId: string, teamIds: readonly string[]) {
  const unique = [...new Set(teamIds)];
  if (unique.length === 0) return;
  const rows = await tx
    .select({ id: team.id })
    .from(team)
    .where(and(eq(team.organizationId, organizationId), inArray(team.id, unique), isNull(team.deletedAt)));
  if (rows.length !== unique.length)
    throw new ValidationError("Equipo inválido", { teamIds: ["Equipo inválido"] });
}

export async function assertMembershipsInOrg(
  tx: DbOrTx,
  organizationId: string,
  membershipIds: readonly string[],
) {
  const unique = [...new Set(membershipIds)];
  if (unique.length === 0) return;
  const rows = await tx
    .select({ id: membership.id })
    .from(membership)
    .where(and(eq(membership.organizationId, organizationId), inArray(membership.id, unique)));
  if (rows.length !== unique.length)
    throw new ValidationError("Usuario inválido", { members: ["Usuario inválido"] });
}

export const SUPER_ADMIN_KEY = "super_admin";

/** Solo un Super Admin puede otorgar o quitar el rol Super Admin (roles bloqueados). */
export function assertCanTouchLockedRoles(ctx: RequestContext, lockedRoleTouched: boolean): void {
  if (lockedRoleTouched && !ctx.roleKeys.includes(SUPER_ADMIN_KEY)) {
    throw new ForbiddenError("Solo un Super Admin puede asignar o quitar el rol Super Admin");
  }
}

/** Nunca dejar a la organización sin al menos un Super Admin activo. */
export async function assertSuperAdminRemains(tx: DbOrTx, organizationId: string): Promise<void> {
  const [row] = await tx
    .select({ n: count() })
    .from(membershipRole)
    .innerJoin(role, eq(role.id, membershipRole.roleId))
    .innerJoin(membership, eq(membership.id, membershipRole.membershipId))
    .where(
      and(
        eq(membershipRole.organizationId, organizationId),
        eq(role.key, SUPER_ADMIN_KEY),
        isNull(membershipRole.branchId),
        eq(membership.status, "active"),
      ),
    );
  if ((row?.n ?? 0) < 1)
    throw new ConflictError("La organización debe conservar al menos un Super Admin activo");
}
