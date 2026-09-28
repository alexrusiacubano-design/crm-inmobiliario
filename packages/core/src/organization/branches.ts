import { and, asc, count, eq, isNull } from "drizzle-orm";
import { branch, membership, team, type Db, type DbOrTx } from "@crm/db";
import { branchSchema, updateBranchSchema } from "@crm/shared/validation";
import { writeAudit } from "../audit";
import { requirePermission, type RequestContext } from "../context";
import { ConflictError, NotFoundError, isUniqueViolation, parseInput } from "../errors";
import { emitEvent } from "../events";

export async function listBranches(db: DbOrTx, ctx: RequestContext) {
  // Las sucursales se muestran en selectores de toda la app: basta con estar autenticado.
  const rows = await db
    .select({
      id: branch.id,
      name: branch.name,
      code: branch.code,
      address: branch.address,
      phone: branch.phone,
      isActive: branch.isActive,
    })
    .from(branch)
    .where(and(eq(branch.organizationId, ctx.organizationId), isNull(branch.deletedAt)))
    .orderBy(asc(branch.name));

  const [teamCounts, memberCounts] = await Promise.all([
    db
      .select({ branchId: team.branchId, n: count() })
      .from(team)
      .where(and(eq(team.organizationId, ctx.organizationId), isNull(team.deletedAt)))
      .groupBy(team.branchId),
    db
      .select({ branchId: membership.defaultBranchId, n: count() })
      .from(membership)
      .where(eq(membership.organizationId, ctx.organizationId))
      .groupBy(membership.defaultBranchId),
  ]);

  return rows.map((b) => ({
    ...b,
    teamCount: teamCounts.find((t) => t.branchId === b.id)?.n ?? 0,
    memberCount: memberCounts.find((m) => m.branchId === b.id)?.n ?? 0,
  }));
}

export async function createBranch(db: Db, ctx: RequestContext, rawInput: unknown) {
  requirePermission(ctx, "branches.manage");
  const input = parseInput(branchSchema, rawInput);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(branch)
        .values({ organizationId: ctx.organizationId, ...input })
        .returning();
      if (!row) throw new Error("No se pudo crear la sucursal");
      await writeAudit(tx, ctx, {
        action: "branch.create",
        entityType: "branch",
        entityId: row.id,
        after: row,
      });
      await emitEvent(tx, ctx, { type: "branch.created", aggregateType: "branch", aggregateId: row.id });
      return row;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError("Ya existe una sucursal con ese código");
    throw error;
  }
}

export async function updateBranch(db: Db, ctx: RequestContext, rawInput: unknown) {
  requirePermission(ctx, "branches.manage");
  const { id, ...input } = parseInput(updateBranchSchema, rawInput);
  try {
    return await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(branch)
        .where(
          and(eq(branch.id, id), eq(branch.organizationId, ctx.organizationId), isNull(branch.deletedAt)),
        );
      if (!before) throw new NotFoundError("Sucursal");
      const [after] = await tx.update(branch).set(input).where(eq(branch.id, id)).returning();
      await writeAudit(tx, ctx, {
        action: "branch.update",
        entityType: "branch",
        entityId: id,
        before,
        after,
      });
      if (before.isActive !== input.isActive) {
        await writeAudit(tx, ctx, {
          action: "branch.status_change",
          entityType: "branch",
          entityId: id,
          before: { isActive: before.isActive },
          after: { isActive: input.isActive },
        });
      }
      await emitEvent(tx, ctx, { type: "branch.updated", aggregateType: "branch", aggregateId: id });
      return after;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError("Ya existe una sucursal con ese código");
    throw error;
  }
}
