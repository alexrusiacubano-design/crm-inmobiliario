import { and, count, desc, eq, type SQL } from "drizzle-orm";
import { auditLog, user, type DbOrTx } from "@crm/db";
import { auditQuerySchema } from "@crm/shared/validation";
import type { RequestContext } from "./context";
import { parseInput } from "./errors";
import { requirePermission } from "./context";

/** Campos que nunca se guardan en la auditoría. */
const REDACTED_KEYS = new Set([
  "password",
  "secret",
  "backupCodes",
  "token",
  "accessToken",
  "refreshToken",
  "idToken",
]);

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Convierte a JSON seguro: bigint → string, fechas → ISO, secretos → "[redactado]". */
export function toAuditJson(value: unknown): Json {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toAuditJson);
  if (typeof value === "object") {
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACTED_KEYS.has(k) ? "[redactado]" : toAuditJson(v);
    }
    return out;
  }
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") return value;
  return String(value);
}

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

/**
 * Registra una acción. DEBE llamarse con la misma transacción que el cambio: si el cambio
 * se revierte, la auditoría también; si la auditoría falla, el cambio no se confirma.
 */
export async function writeAudit(tx: DbOrTx, ctx: RequestContext, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    before: entry.before === undefined ? null : toAuditJson(entry.before),
    after: entry.after === undefined ? null : toAuditJson(entry.after),
    metadata: {
      ip: ctx.meta.ip ?? null,
      userAgent: ctx.meta.userAgent ?? null,
      requestId: ctx.meta.requestId,
    },
  });
}

export async function listAuditLogs(db: DbOrTx, ctx: RequestContext, rawQuery: unknown) {
  requirePermission(ctx, "audit.read");
  const q = parseInput(auditQuerySchema, rawQuery);

  const conditions: SQL[] = [eq(auditLog.organizationId, ctx.organizationId)];
  if (q.entityType) conditions.push(eq(auditLog.entityType, q.entityType));
  if (q.action) conditions.push(eq(auditLog.action, q.action));
  if (q.actorUserId) conditions.push(eq(auditLog.actorUserId, q.actorUserId));
  const where = and(...conditions);

  const [rows, totals] = await Promise.all([
    db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        before: auditLog.before,
        after: auditLog.after,
        metadata: auditLog.metadata,
        createdAt: auditLog.createdAt,
        actorName: user.name,
        actorEmail: user.email,
      })
      .from(auditLog)
      .leftJoin(user, eq(user.id, auditLog.actorUserId))
      .where(where)
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ total: count() }).from(auditLog).where(where),
  ]);

  return { items: rows, total: totals[0]?.total ?? 0, page: q.page, pageSize: q.pageSize };
}
