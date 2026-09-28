import { inArray, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { accessFilter, type PermissionCode } from "@crm/shared/rbac";
import type { RequestContext } from "./context";

/**
 * Traduce los permisos con alcance a una condición SQL para listados. Los módulos de fases
 * siguientes (leads, propiedades, operaciones…) la combinan con `organization_id` para que
 * el filtrado ocurra en la base y un agente no pueda ver registros ajenos.
 */
export function scopeCondition(
  ctx: RequestContext,
  code: PermissionCode,
  columns: { ownerUserId?: AnyColumn; teamId?: AnyColumn; branchId?: AnyColumn },
): SQL {
  const filter = accessFilter(ctx.grants, ctx.subject, code);
  if (filter.kind === "all") return sql`true`;
  if (filter.kind === "none") return sql`false`;

  const parts: SQL[] = [];
  if (columns.ownerUserId && filter.ownerUserIds.length)
    parts.push(inArray(columns.ownerUserId, [...filter.ownerUserIds]));
  if (columns.teamId && filter.teamIds.length) parts.push(inArray(columns.teamId, [...filter.teamIds]));
  if (columns.branchId && filter.branchIds.length)
    parts.push(inArray(columns.branchId, [...filter.branchIds]));
  return parts.length ? (or(...parts) ?? sql`false`) : sql`false`;
}
