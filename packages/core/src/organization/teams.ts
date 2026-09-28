import { and, asc, count, eq, isNull } from "drizzle-orm";
import { branch, membership, team, teamMember, user, type Db, type DbOrTx } from "@crm/db";
import { teamSchema, updateTeamSchema, uuidSchema } from "@crm/shared/validation";
import { z } from "zod";
import { writeAudit } from "../audit";
import { requirePermission, type RequestContext } from "../context";
import { ConflictError, NotFoundError, isUniqueViolation, parseInput } from "../errors";
import { emitEvent } from "../events";
import { assertBranchesInOrg, assertMembershipsInOrg } from "./guards";

export async function listTeams(db: DbOrTx, ctx: RequestContext) {
  const lead = db
    .select({ membershipId: membership.id, name: user.name })
    .from(membership)
    .innerJoin(user, eq(user.id, membership.userId))
    .as("lead");

  const rows = await db
    .select({
      id: team.id,
      name: team.name,
      isActive: team.isActive,
      branchId: team.branchId,
      branchName: branch.name,
      leadMembershipId: team.leadMembershipId,
      leadName: lead.name,
    })
    .from(team)
    .innerJoin(branch, eq(branch.id, team.branchId))
    .leftJoin(lead, eq(lead.membershipId, team.leadMembershipId))
    .where(and(eq(team.organizationId, ctx.organizationId), isNull(team.deletedAt)))
    .orderBy(asc(branch.name), asc(team.name));

  const counts = await db
    .select({ teamId: teamMember.teamId, n: count() })
    .from(teamMember)
    .where(eq(teamMember.organizationId, ctx.organizationId))
    .groupBy(teamMember.teamId);

  return rows.map((t) => ({ ...t, memberCount: counts.find((c) => c.teamId === t.id)?.n ?? 0 }));
}

export async function listTeamMembers(db: DbOrTx, ctx: RequestContext, teamId: string) {
  requirePermission(ctx, "users.read");
  return db
    .select({ membershipId: membership.id, name: user.name, email: user.email })
    .from(teamMember)
    .innerJoin(membership, eq(membership.id, teamMember.membershipId))
    .innerJoin(user, eq(user.id, membership.userId))
    .where(and(eq(teamMember.teamId, teamId), eq(teamMember.organizationId, ctx.organizationId)))
    .orderBy(asc(user.name));
}

async function saveTeam(
  db: Db,
  ctx: RequestContext,
  input: z.output<typeof teamSchema> & { id?: string; isActive?: boolean },
) {
  try {
    return await db.transaction(async (tx) => {
      await assertBranchesInOrg(tx, ctx.organizationId, [input.branchId]);
      if (input.leadMembershipId)
        await assertMembershipsInOrg(tx, ctx.organizationId, [input.leadMembershipId]);

      if (!input.id) {
        const [row] = await tx
          .insert(team)
          .values({
            organizationId: ctx.organizationId,
            name: input.name,
            branchId: input.branchId,
            leadMembershipId: input.leadMembershipId,
          })
          .returning();
        if (!row) throw new Error("No se pudo crear el equipo");
        if (row.leadMembershipId) {
          await tx
            .insert(teamMember)
            .values({
              organizationId: ctx.organizationId,
              teamId: row.id,
              membershipId: row.leadMembershipId,
            })
            .onConflictDoNothing();
        }
        await writeAudit(tx, ctx, {
          action: "team.create",
          entityType: "team",
          entityId: row.id,
          after: row,
        });
        await emitEvent(tx, ctx, { type: "team.created", aggregateType: "team", aggregateId: row.id });
        return row;
      }

      const [before] = await tx
        .select()
        .from(team)
        .where(
          and(eq(team.id, input.id), eq(team.organizationId, ctx.organizationId), isNull(team.deletedAt)),
        );
      if (!before) throw new NotFoundError("Equipo");
      const [after] = await tx
        .update(team)
        .set({
          name: input.name,
          branchId: input.branchId,
          leadMembershipId: input.leadMembershipId,
          isActive: input.isActive ?? before.isActive,
        })
        .where(eq(team.id, input.id))
        .returning();
      if (after?.leadMembershipId) {
        await tx
          .insert(teamMember)
          .values({
            organizationId: ctx.organizationId,
            teamId: after.id,
            membershipId: after.leadMembershipId,
          })
          .onConflictDoNothing();
      }
      await writeAudit(tx, ctx, {
        action: "team.update",
        entityType: "team",
        entityId: input.id,
        before,
        after,
      });
      await emitEvent(tx, ctx, { type: "team.updated", aggregateType: "team", aggregateId: input.id });
      return after;
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw new ConflictError("Ya existe un equipo con ese nombre en la sucursal");
    throw error;
  }
}

export async function createTeam(db: Db, ctx: RequestContext, rawInput: unknown) {
  requirePermission(ctx, "teams.manage");
  return saveTeam(db, ctx, parseInput(teamSchema, rawInput));
}

export async function updateTeam(db: Db, ctx: RequestContext, rawInput: unknown) {
  requirePermission(ctx, "teams.manage");
  return saveTeam(db, ctx, parseInput(updateTeamSchema, rawInput));
}

const setTeamMembersSchema = z.object({ teamId: uuidSchema, membershipIds: z.array(uuidSchema).max(500) });

export async function setTeamMembers(db: Db, ctx: RequestContext, rawInput: unknown) {
  requirePermission(ctx, "teams.manage");
  const input = parseInput(setTeamMembersSchema, rawInput);
  return db.transaction(async (tx) => {
    const [t] = await tx
      .select({ id: team.id, leadMembershipId: team.leadMembershipId })
      .from(team)
      .where(
        and(eq(team.id, input.teamId), eq(team.organizationId, ctx.organizationId), isNull(team.deletedAt)),
      );
    if (!t) throw new NotFoundError("Equipo");
    await assertMembershipsInOrg(tx, ctx.organizationId, input.membershipIds);

    const before = await tx
      .select({ membershipId: teamMember.membershipId })
      .from(teamMember)
      .where(eq(teamMember.teamId, t.id));
    const ids = new Set(input.membershipIds);
    if (t.leadMembershipId) ids.add(t.leadMembershipId);

    await tx.delete(teamMember).where(eq(teamMember.teamId, t.id));
    if (ids.size) {
      await tx.insert(teamMember).values(
        [...ids].map((membershipId) => ({
          organizationId: ctx.organizationId,
          teamId: t.id,
          membershipId,
        })),
      );
    }
    await writeAudit(tx, ctx, {
      action: "team.members_change",
      entityType: "team",
      entityId: t.id,
      before: before.map((b) => b.membershipId).sort(),
      after: [...ids].sort(),
    });
    await emitEvent(tx, ctx, { type: "team.members_changed", aggregateType: "team", aggregateId: t.id });
  });
}
