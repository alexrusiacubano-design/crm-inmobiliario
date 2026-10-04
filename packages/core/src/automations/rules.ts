import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { automationRule, automationRun, membership, role, user, type Db, type DbOrTx } from "@crm/db";
import { automationRuleSchema } from "@crm/shared/validation/automations";
import { uuidSchema } from "@crm/shared/validation";
import { writeAudit } from "../audit";
import { requirePermission, type RequestContext } from "../context";
import { NotFoundError, ValidationError, parseInput } from "../errors";
import { runScheduledAutomations } from "./engine";

export async function automationOptions(db: DbOrTx, ctx: RequestContext) {
  requirePermission(ctx, "automation.manage");
  const [users, roles] = await Promise.all([
    db
      .select({ userId: user.id, name: user.name })
      .from(membership)
      .innerJoin(user, eq(user.id, membership.userId))
      .where(and(eq(membership.organizationId, ctx.organizationId), eq(membership.status, "active")))
      .orderBy(asc(user.name)),
    db
      .select({ key: role.key, name: role.name })
      .from(role)
      .where(and(eq(role.organizationId, ctx.organizationId), isNull(role.deletedAt)))
      .orderBy(asc(role.name)),
  ]);
  return { users, roles };
}

export async function listRules(db: DbOrTx, ctx: RequestContext) {
  requirePermission(ctx, "automation.manage");
  const rows = await db
    .select({ r: automationRule, actsAs: user.name })
    .from(automationRule)
    .innerJoin(user, eq(user.id, automationRule.createdById))
    .where(and(eq(automationRule.organizationId, ctx.organizationId), isNull(automationRule.deletedAt)))
    .orderBy(desc(automationRule.enabled), asc(automationRule.name));
  return rows.map(({ r, actsAs }) => ({
    id: r.id,
    name: r.name,
    enabled: r.enabled,
    trigger: r.trigger,
    days: r.days,
    conditions: r.conditions,
    actions: r.actions,
    runCount: r.runCount,
    lastRunAt: r.lastRunAt,
    actsAs,
    secret: r.secret,
  }));
}

async function loadRule(tx: DbOrTx, ctx: RequestContext, id: string) {
  const [r] = await tx
    .select()
    .from(automationRule)
    .where(
      and(
        eq(automationRule.id, parseInput(uuidSchema, id)),
        eq(automationRule.organizationId, ctx.organizationId),
        isNull(automationRule.deletedAt),
      ),
    );
  if (!r) throw new NotFoundError("Automatización");
  return r;
}

/**
 * Crea o edita una regla. Quien guarda pasa a ser con cuyos permisos se ejecuta (así una
 * regla nunca actúa con más permisos que la última persona que la revisó).
 */
export async function saveRule(db: Db, ctx: RequestContext, rawInput: unknown) {
  requirePermission(ctx, "automation.manage");
  const input = parseInput(automationRuleSchema, rawInput);
  const userIds = new Set<string>();
  const roleKeys = new Set<string>();
  for (const a of input.actions) {
    if (a.type === "assign") a.userIds.forEach((u) => userIds.add(u));
    if ((a.type === "notify" || a.type === "task") && a.to === "user" && a.userId) userIds.add(a.userId);
    if (a.type === "notify" && a.to === "role" && a.roleKey) roleKeys.add(a.roleKey);
  }
  return db.transaction(async (tx) => {
    if (userIds.size) {
      const found = await tx
        .select({ userId: membership.userId })
        .from(membership)
        .where(
          and(
            eq(membership.organizationId, ctx.organizationId),
            eq(membership.status, "active"),
            inArray(membership.userId, [...userIds]),
          ),
        );
      if (found.length !== userIds.size)
        throw new ValidationError("Hay usuarios que no están activos en la organización", {
          actions: ["Revisá los usuarios elegidos"],
        });
    }
    if (roleKeys.size) {
      const found = await tx
        .select({ key: role.key })
        .from(role)
        .where(
          and(
            eq(role.organizationId, ctx.organizationId),
            inArray(role.key, [...roleKeys]),
            isNull(role.deletedAt),
          ),
        );
      if (found.length !== roleKeys.size)
        throw new ValidationError("El rol elegido no existe", { actions: ["Revisá el rol"] });
    }
    const values = {
      name: input.name,
      enabled: input.enabled,
      trigger: input.trigger,
      days: input.days ?? null,
      conditions: input.conditions,
      actions: input.actions,
      createdById: ctx.userId,
    };
    if (input.id) {
      const before = await loadRule(tx, ctx, input.id);
      const [after] = await tx
        .update(automationRule)
        .set({ ...values, state: before.trigger === input.trigger ? before.state : {} })
        .where(eq(automationRule.id, before.id))
        .returning();
      if (!after) throw new Error("No se pudo guardar la automatización");
      await writeAudit(tx, ctx, {
        action: "automation.update",
        entityType: "automation_rule",
        entityId: before.id,
        before: { ...before, secret: undefined },
        after: { ...after, secret: undefined },
      });
      return after;
    }
    const [row] = await tx
      .insert(automationRule)
      .values({ organizationId: ctx.organizationId, ...values, secret: randomBytes(24).toString("hex") })
      .returning();
    if (!row) throw new Error("No se pudo crear la automatización");
    await writeAudit(tx, ctx, {
      action: "automation.create",
      entityType: "automation_rule",
      entityId: row.id,
      after: { ...row, secret: undefined },
    });
    return row;
  });
}

export async function setRuleEnabled(db: Db, ctx: RequestContext, id: string, enabled: boolean) {
  requirePermission(ctx, "automation.manage");
  return db.transaction(async (tx) => {
    const before = await loadRule(tx, ctx, id);
    await tx.update(automationRule).set({ enabled }).where(eq(automationRule.id, before.id));
    await writeAudit(tx, ctx, {
      action: enabled ? "automation.enable" : "automation.disable",
      entityType: "automation_rule",
      entityId: before.id,
      before: { enabled: before.enabled },
      after: { enabled },
    });
  });
}

export async function deleteRule(db: Db, ctx: RequestContext, id: string) {
  requirePermission(ctx, "automation.manage");
  return db.transaction(async (tx) => {
    const before = await loadRule(tx, ctx, id);
    await tx
      .update(automationRule)
      .set({ deletedAt: new Date(), enabled: false })
      .where(eq(automationRule.id, before.id));
    await writeAudit(tx, ctx, {
      action: "automation.delete",
      entityType: "automation_rule",
      entityId: before.id,
      before: { name: before.name, trigger: before.trigger },
    });
  });
}

export async function listRuns(
  db: DbOrTx,
  ctx: RequestContext,
  opts: { ruleId?: string; limit?: number } = {},
) {
  requirePermission(ctx, "automation.manage");
  const rows = await db
    .select({ run: automationRun, ruleName: automationRule.name })
    .from(automationRun)
    .innerJoin(automationRule, eq(automationRule.id, automationRun.ruleId))
    .where(
      and(
        eq(automationRun.organizationId, ctx.organizationId),
        opts.ruleId ? eq(automationRun.ruleId, parseInput(uuidSchema, opts.ruleId)) : undefined,
      ),
    )
    .orderBy(desc(automationRun.createdAt))
    .limit(Math.min(opts.limit ?? 50, 200));
  return rows.map(({ run, ruleName }) => ({ ...run, ruleName }));
}

/** "Ejecutar ahora" los disparadores programados de la organización. */
export async function runScheduleNow(db: Db, ctx: RequestContext) {
  requirePermission(ctx, "automation.manage");
  return runScheduledAutomations(db, { organizationId: ctx.organizationId });
}
