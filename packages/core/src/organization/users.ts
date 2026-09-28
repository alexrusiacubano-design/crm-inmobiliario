import { and, asc, count, eq, ilike, inArray, or, type SQL } from "drizzle-orm";
import {
  branch,
  membership,
  membershipRole,
  role,
  session,
  team,
  teamMember,
  user,
  type Db,
  type DbOrTx,
} from "@crm/db";
import { insertCredentialUser, setCredentialPassword } from "@crm/db/credentials";
import {
  createUserSchema,
  listQuerySchema,
  resetPasswordSchema,
  setMembershipStatusSchema,
  updateUserSchema,
} from "@crm/shared/validation";
import { writeAudit } from "../audit";
import { requirePermission, type RequestContext } from "../context";
import { ConflictError, ForbiddenError, NotFoundError, isUniqueViolation, parseInput } from "../errors";
import { emitEvent } from "../events";
import {
  assertBranchesInOrg,
  assertCanTouchLockedRoles,
  assertSuperAdminRemains,
  assertTeamsInOrg,
  loadRolesInOrg,
} from "./guards";

export interface MemberSnapshot {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  status: "active" | "suspended";
  jobTitle: string | null;
  phone: string | null;
  defaultBranchId: string | null;
  twoFactorEnabled: boolean;
  roles: { roleId: string; roleKey: string; roleName: string; branchId: string | null }[];
  teamIds: string[];
}

async function getSnapshot(
  db: DbOrTx,
  organizationId: string,
  membershipId: string,
): Promise<MemberSnapshot> {
  const [m] = await db
    .select({
      membershipId: membership.id,
      userId: user.id,
      name: user.name,
      email: user.email,
      status: membership.status,
      jobTitle: membership.jobTitle,
      phone: membership.phone,
      defaultBranchId: membership.defaultBranchId,
      twoFactorEnabled: user.twoFactorEnabled,
    })
    .from(membership)
    .innerJoin(user, eq(user.id, membership.userId))
    .where(and(eq(membership.id, membershipId), eq(membership.organizationId, organizationId)));
  if (!m) throw new NotFoundError("Usuario");

  const roles = await db
    .select({ roleId: role.id, roleKey: role.key, roleName: role.name, branchId: membershipRole.branchId })
    .from(membershipRole)
    .innerJoin(role, eq(role.id, membershipRole.roleId))
    .where(eq(membershipRole.membershipId, membershipId))
    .orderBy(asc(role.name));
  const teams = await db
    .select({ teamId: teamMember.teamId })
    .from(teamMember)
    .where(eq(teamMember.membershipId, membershipId));

  return { ...m, roles, teamIds: teams.map((t) => t.teamId) };
}

export async function getMember(
  db: DbOrTx,
  ctx: RequestContext,
  membershipId: string,
): Promise<MemberSnapshot> {
  requirePermission(ctx, "users.read");
  return getSnapshot(db, ctx.organizationId, membershipId);
}

export async function listMembers(db: DbOrTx, ctx: RequestContext, rawQuery: unknown) {
  requirePermission(ctx, "users.read");
  const q = parseInput(listQuerySchema, rawQuery);

  const conditions: (SQL | undefined)[] = [eq(membership.organizationId, ctx.organizationId)];
  if (q.q) conditions.push(or(ilike(user.name, `%${q.q}%`), ilike(user.email, `%${q.q}%`)));
  const where = and(...conditions);

  const [rows, totals] = await Promise.all([
    db
      .select({
        membershipId: membership.id,
        userId: user.id,
        name: user.name,
        email: user.email,
        status: membership.status,
        jobTitle: membership.jobTitle,
        twoFactorEnabled: user.twoFactorEnabled,
        branchName: branch.name,
        createdAt: membership.createdAt,
      })
      .from(membership)
      .innerJoin(user, eq(user.id, membership.userId))
      .leftJoin(branch, eq(branch.id, membership.defaultBranchId))
      .where(where)
      .orderBy(asc(user.name))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db
      .select({ total: count() })
      .from(membership)
      .innerJoin(user, eq(user.id, membership.userId))
      .where(where),
  ]);

  const ids = rows.map((r) => r.membershipId);
  const [roleRows, teamRows] =
    ids.length === 0
      ? [[], []]
      : await Promise.all([
          db
            .select({ membershipId: membershipRole.membershipId, name: role.name, branchName: branch.name })
            .from(membershipRole)
            .innerJoin(role, eq(role.id, membershipRole.roleId))
            .leftJoin(branch, eq(branch.id, membershipRole.branchId))
            .where(inArray(membershipRole.membershipId, ids)),
          db
            .select({ membershipId: teamMember.membershipId, name: team.name })
            .from(teamMember)
            .innerJoin(team, eq(team.id, teamMember.teamId))
            .where(inArray(teamMember.membershipId, ids)),
        ]);

  return {
    items: rows.map((r) => ({
      ...r,
      roles: roleRows
        .filter((x) => x.membershipId === r.membershipId)
        .map((x) => (x.branchName ? `${x.name} · ${x.branchName}` : x.name)),
      teams: teamRows.filter((x) => x.membershipId === r.membershipId).map((x) => x.name),
    })),
    total: totals[0]?.total ?? 0,
    page: q.page,
    pageSize: q.pageSize,
  };
}

async function replaceAssignments(
  tx: DbOrTx,
  ctx: RequestContext,
  membershipId: string,
  roles: readonly { roleId: string; branchId: string | null }[],
  teamIds: readonly string[],
): Promise<void> {
  await tx.delete(membershipRole).where(eq(membershipRole.membershipId, membershipId));
  const uniqueRoles = [...new Map(roles.map((r) => [`${r.roleId}:${r.branchId ?? ""}`, r])).values()];
  await tx.insert(membershipRole).values(
    uniqueRoles.map((r) => ({
      organizationId: ctx.organizationId,
      membershipId,
      roleId: r.roleId,
      branchId: r.branchId,
    })),
  );

  await tx.delete(teamMember).where(eq(teamMember.membershipId, membershipId));
  const uniqueTeams = [...new Set(teamIds)];
  if (uniqueTeams.length) {
    await tx
      .insert(teamMember)
      .values(uniqueTeams.map((teamId) => ({ organizationId: ctx.organizationId, teamId, membershipId })));
  }
}

export async function createMember(db: Db, ctx: RequestContext, rawInput: unknown): Promise<MemberSnapshot> {
  requirePermission(ctx, "users.manage");
  const input = parseInput(createUserSchema, rawInput);

  return db.transaction(async (tx) => {
    const roleRows = await loadRolesInOrg(
      tx,
      ctx.organizationId,
      input.roles.map((r) => r.roleId),
    );
    assertCanTouchLockedRoles(
      ctx,
      roleRows.some((r) => r.isLocked),
    );
    await assertBranchesInOrg(tx, ctx.organizationId, [
      input.defaultBranchId,
      ...input.roles.map((r) => r.branchId),
    ]);
    await assertTeamsInOrg(tx, ctx.organizationId, input.teamIds);

    const [existing] = await tx.select({ id: user.id }).from(user).where(eq(user.email, input.email));
    if (existing) throw new ConflictError("Ya existe un usuario con ese email");

    let userId: string;
    try {
      ({ id: userId } = await insertCredentialUser(tx, {
        name: input.name,
        email: input.email,
        password: input.password,
      }));
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictError("Ya existe un usuario con ese email");
      throw error;
    }

    const [m] = await tx
      .insert(membership)
      .values({
        organizationId: ctx.organizationId,
        userId,
        defaultBranchId: input.defaultBranchId,
        jobTitle: input.jobTitle ?? null,
        phone: input.phone ?? null,
      })
      .returning({ id: membership.id });
    if (!m) throw new Error("No se pudo crear la membresía");

    await replaceAssignments(tx, ctx, m.id, input.roles, input.teamIds);
    const after = await getSnapshot(tx, ctx.organizationId, m.id);
    await writeAudit(tx, ctx, { action: "user.create", entityType: "user", entityId: m.id, after });
    await emitEvent(tx, ctx, { type: "user.created", aggregateType: "user", aggregateId: m.id });
    return after;
  });
}

export async function updateMember(db: Db, ctx: RequestContext, rawInput: unknown): Promise<MemberSnapshot> {
  requirePermission(ctx, "users.manage");
  const input = parseInput(updateUserSchema, rawInput);

  return db.transaction(async (tx) => {
    const before = await getSnapshot(tx, ctx.organizationId, input.membershipId);
    const roleRows = await loadRolesInOrg(
      tx,
      ctx.organizationId,
      input.roles.map((r) => r.roleId),
    );

    const lockedBefore = before.roles.some((r) => r.roleKey === "super_admin");
    const lockedAfter = roleRows.some((r) => r.isLocked);
    assertCanTouchLockedRoles(ctx, lockedBefore || lockedAfter);

    await assertBranchesInOrg(tx, ctx.organizationId, [
      input.defaultBranchId,
      ...input.roles.map((r) => r.branchId),
    ]);
    await assertTeamsInOrg(tx, ctx.organizationId, input.teamIds);

    await tx.update(user).set({ name: input.name }).where(eq(user.id, before.userId));
    await tx
      .update(membership)
      .set({
        jobTitle: input.jobTitle ?? null,
        phone: input.phone ?? null,
        defaultBranchId: input.defaultBranchId,
      })
      .where(and(eq(membership.id, input.membershipId), eq(membership.organizationId, ctx.organizationId)));
    await replaceAssignments(tx, ctx, input.membershipId, input.roles, input.teamIds);
    await assertSuperAdminRemains(tx, ctx.organizationId);

    const after = await getSnapshot(tx, ctx.organizationId, input.membershipId);
    await writeAudit(tx, ctx, {
      action: "user.update",
      entityType: "user",
      entityId: input.membershipId,
      before,
      after,
    });
    const rolesChanged = JSON.stringify(before.roles) !== JSON.stringify(after.roles);
    if (rolesChanged) {
      await writeAudit(tx, ctx, {
        action: "permission.assignment_change",
        entityType: "user",
        entityId: input.membershipId,
        before: before.roles,
        after: after.roles,
      });
    }
    await emitEvent(tx, ctx, {
      type: "user.updated",
      aggregateType: "user",
      aggregateId: input.membershipId,
    });
    return after;
  });
}

export async function setMemberStatus(
  db: Db,
  ctx: RequestContext,
  rawInput: unknown,
): Promise<MemberSnapshot> {
  requirePermission(ctx, "users.manage");
  const input = parseInput(setMembershipStatusSchema, rawInput);
  if (input.membershipId === ctx.membershipId)
    throw new ForbiddenError("No podés cambiar el estado de tu propio usuario");

  return db.transaction(async (tx) => {
    const before = await getSnapshot(tx, ctx.organizationId, input.membershipId);
    assertCanTouchLockedRoles(
      ctx,
      before.roles.some((r) => r.roleKey === "super_admin"),
    );
    if (before.status === input.status) return before;

    await tx
      .update(membership)
      .set({ status: input.status })
      .where(and(eq(membership.id, input.membershipId), eq(membership.organizationId, ctx.organizationId)));

    if (input.status === "suspended") {
      await assertSuperAdminRemains(tx, ctx.organizationId);
      // Cierra todas las sesiones abiertas del usuario suspendido.
      await tx.delete(session).where(eq(session.userId, before.userId));
    }

    const after = await getSnapshot(tx, ctx.organizationId, input.membershipId);
    await writeAudit(tx, ctx, {
      action: input.status === "suspended" ? "user.suspend" : "user.reactivate",
      entityType: "user",
      entityId: input.membershipId,
      before: { status: before.status },
      after: { status: after.status },
    });
    await emitEvent(tx, ctx, {
      type: `user.${input.status}`,
      aggregateType: "user",
      aggregateId: input.membershipId,
    });
    return after;
  });
}

export async function resetMemberPassword(db: Db, ctx: RequestContext, rawInput: unknown): Promise<void> {
  requirePermission(ctx, "users.manage");
  const input = parseInput(resetPasswordSchema, rawInput);

  await db.transaction(async (tx) => {
    const target = await getSnapshot(tx, ctx.organizationId, input.membershipId);
    assertCanTouchLockedRoles(
      ctx,
      target.roles.some((r) => r.roleKey === "super_admin") && target.userId !== ctx.userId,
    );
    await setCredentialPassword(tx, target.userId, input.password);
    await tx.delete(session).where(eq(session.userId, target.userId));
    await writeAudit(tx, ctx, {
      action: "user.password_reset",
      entityType: "user",
      entityId: input.membershipId,
    });
  });
}
