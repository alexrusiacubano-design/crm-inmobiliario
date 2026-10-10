import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  branch,
  membership,
  membershipRole,
  organization,
  role,
  rolePermission,
  team,
  teamMember,
  type DbOrTx,
} from "@crm/db";
import {
  can,
  isPermissionCode,
  type PermissionCode,
  type ResolvedGrant,
  type ResourceRef,
  type Subject,
} from "@crm/shared/rbac";
import { ForbiddenError, UnauthenticatedError } from "./errors";

export interface RequestMeta {
  readonly ip?: string | null;
  readonly userAgent?: string | null;
  readonly requestId?: string;
}

/**
 * Todo lo que un servicio necesita saber de quién actúa. Se construye en el servidor a
 * partir de la sesión; el cliente nunca lo envía.
 */
export interface RequestContext {
  readonly userId: string;
  readonly membershipId: string;
  readonly organizationId: string;
  readonly organization: {
    readonly name: string;
    readonly isDemo: boolean;
    readonly timezone: string;
    /** URL del logo de la organización (ruta pública de la app) o null. */
    readonly logoUrl: string | null;
  };
  readonly subject: Subject;
  readonly grants: readonly ResolvedGrant[];
  readonly roleKeys: readonly string[];
  readonly meta: RequestMeta;
}

/** Ruta pública del logo, versionada para que el navegador no muestre uno viejo. */
export function orgLogoUrl(organizationId: string, logoKey: string | null, updatedAt: Date | null): string | null {
  if (!logoKey) return null;
  return `/api/logo/${organizationId}?v=${updatedAt ? updatedAt.getTime().toString(36) : "1"}`;
}

export async function loadContext(
  db: DbOrTx,
  input: { userId: string; organizationId?: string | null; meta?: RequestMeta },
): Promise<RequestContext> {
  const memberships = await db
    .select({
      id: membership.id,
      organizationId: membership.organizationId,
      defaultBranchId: membership.defaultBranchId,
      orgName: organization.name,
      isDemo: organization.isDemo,
      timezone: organization.timezone,
      logoKey: organization.logoKey,
      logoUpdatedAt: organization.logoUpdatedAt,
    })
    .from(membership)
    .innerJoin(organization, eq(organization.id, membership.organizationId))
    .where(
      and(
        eq(membership.userId, input.userId),
        eq(membership.status, "active"),
        input.organizationId ? eq(membership.organizationId, input.organizationId) : undefined,
      ),
    )
    .orderBy(asc(membership.createdAt))
    .limit(1);

  const m = memberships[0];
  if (!m) throw new UnauthenticatedError("El usuario no tiene una membresía activa");

  const grantRows = await db
    .select({
      code: rolePermission.permissionCode,
      scope: rolePermission.scope,
      restrictedToBranchId: membershipRole.branchId,
      roleKey: role.key,
    })
    .from(membershipRole)
    .innerJoin(role, and(eq(role.id, membershipRole.roleId), isNull(role.deletedAt)))
    .innerJoin(rolePermission, eq(rolePermission.roleId, role.id))
    .where(eq(membershipRole.membershipId, m.id));

  const grants: ResolvedGrant[] = [];
  for (const row of grantRows) {
    // Un código que ya no existe en el catálogo se ignora: el catálogo en código manda.
    if (isPermissionCode(row.code)) {
      grants.push({ code: row.code, scope: row.scope, restrictedToBranchId: row.restrictedToBranchId });
    }
  }

  const myTeams = await db
    .select({ teamId: team.id, branchId: team.branchId })
    .from(teamMember)
    .innerJoin(team, and(eq(team.id, teamMember.teamId), eq(team.isActive, true), isNull(team.deletedAt)))
    .where(eq(teamMember.membershipId, m.id));

  const teamIds = myTeams.map((t) => t.teamId);
  const mates =
    teamIds.length === 0
      ? []
      : await db
          .selectDistinct({ userId: membership.userId })
          .from(teamMember)
          .innerJoin(membership, eq(membership.id, teamMember.membershipId))
          .where(inArray(teamMember.teamId, teamIds));

  const branchIds = new Set<string>(myTeams.map((t) => t.branchId));
  if (m.defaultBranchId) {
    const [b] = await db.select({ id: branch.id }).from(branch).where(eq(branch.id, m.defaultBranchId));
    if (b) branchIds.add(b.id);
  }

  return {
    userId: input.userId,
    membershipId: m.id,
    organizationId: m.organizationId,
    organization: {
      name: m.orgName,
      isDemo: m.isDemo,
      timezone: m.timezone,
      logoUrl: orgLogoUrl(m.organizationId, m.logoKey, m.logoUpdatedAt),
    },
    subject: {
      userId: input.userId,
      organizationId: m.organizationId,
      branchIds: [...branchIds],
      teamIds,
      teamMateUserIds: [...new Set([input.userId, ...mates.map((x) => x.userId)])],
    },
    grants,
    roleKeys: [...new Set(grantRows.map((g) => g.roleKey))],
    meta: input.meta ?? {},
  };
}

export function hasPermission(ctx: RequestContext, code: PermissionCode, resource?: ResourceRef): boolean {
  return can(ctx.grants, ctx.subject, code, resource);
}

/** Lanza ForbiddenError si el usuario no puede. Úsese al principio de cada servicio. */
export function requirePermission(ctx: RequestContext, code: PermissionCode, resource?: ResourceRef): void {
  if (!hasPermission(ctx, code, resource)) throw new ForbiddenError();
}

/** Garantiza que un registro pertenece a la organización del contexto (anti acceso horizontal). */
export function assertSameOrganization(
  ctx: RequestContext,
  record: { organizationId: string } | undefined,
): void {
  if (!record || record.organizationId !== ctx.organizationId) throw new ForbiddenError();
}
