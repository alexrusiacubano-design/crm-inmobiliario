import { eq, sql } from "drizzle-orm";
import { organization, type Db, type DbOrTx } from "@crm/db";
import { orgSettingsSchema } from "@crm/shared/validation";
import { writeAudit } from "../audit";
import { requirePermission, type RequestContext } from "../context";
import { NotFoundError, ValidationError, parseInput } from "../errors";
import { emitEvent } from "../events";

export async function getOrganization(db: DbOrTx, ctx: RequestContext) {
  const [org] = await db.select().from(organization).where(eq(organization.id, ctx.organizationId));
  if (!org) throw new NotFoundError("Organización");
  return org;
}

/** Totales reales de la organización para el dashboard de la Fase 1. */
export async function getOrganizationSummary(db: DbOrTx, ctx: RequestContext) {
  const [row] = await db
    .execute<{ members: number; active: number; branches: number; teams: number; roles: number }>(
      sql`
    select
      (select count(*)::int from membership where organization_id = ${ctx.organizationId}) as members,
      (select count(*)::int from membership where organization_id = ${ctx.organizationId} and status = 'active') as active,
      (select count(*)::int from branch where organization_id = ${ctx.organizationId} and deleted_at is null and is_active) as branches,
      (select count(*)::int from team where organization_id = ${ctx.organizationId} and deleted_at is null and is_active) as teams,
      (select count(*)::int from role where organization_id = ${ctx.organizationId} and deleted_at is null) as roles
  `,
    )
    .then((r) => r.rows);
  return row ?? { members: 0, active: 0, branches: 0, teams: 0, roles: 0 };
}

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("es-UY", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function updateOrganization(db: Db, ctx: RequestContext, rawInput: unknown) {
  requirePermission(ctx, "settings.manage");
  const input = parseInput(orgSettingsSchema, rawInput);
  if (!isValidTimeZone(input.timezone)) {
    throw new ValidationError("Zona horaria inválida", { timezone: ["Zona horaria inválida"] });
  }
  return db.transaction(async (tx) => {
    const before = await getOrganization(tx, ctx);
    const [after] = await tx
      .update(organization)
      .set(input)
      .where(eq(organization.id, ctx.organizationId))
      .returning();
    await writeAudit(tx, ctx, {
      action: "organization.update",
      entityType: "organization",
      entityId: ctx.organizationId,
      before,
      after,
    });
    await emitEvent(tx, ctx, {
      type: "organization.updated",
      aggregateType: "organization",
      aggregateId: ctx.organizationId,
    });
    return after;
  });
}
