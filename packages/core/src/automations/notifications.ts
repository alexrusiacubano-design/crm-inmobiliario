import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { notification, type Db, type DbOrTx } from "@crm/db";
import { uuidSchema } from "@crm/shared/validation";
import type { RequestContext } from "../context";
import { parseInput } from "../errors";

const mine = (ctx: RequestContext) =>
  and(eq(notification.userId, ctx.userId), eq(notification.organizationId, ctx.organizationId));

export async function unreadNotificationsCount(db: DbOrTx, ctx: RequestContext): Promise<number> {
  const [r] = await db
    .select({ n: count() })
    .from(notification)
    .where(and(mine(ctx), isNull(notification.readAt)));
  return r?.n ?? 0;
}

export async function listNotifications(
  db: DbOrTx,
  ctx: RequestContext,
  opts: { unreadOnly?: boolean; limit?: number } = {},
) {
  return db
    .select()
    .from(notification)
    .where(and(mine(ctx), opts.unreadOnly ? isNull(notification.readAt) : undefined))
    .orderBy(desc(notification.createdAt))
    .limit(Math.min(opts.limit ?? 50, 200));
}

/** Marca como leídas (todas si no se indican ids). Solo las propias. */
export async function markNotificationsRead(db: Db, ctx: RequestContext, ids?: string[]) {
  const parsed = ids?.map((id) => parseInput(uuidSchema, id));
  await db
    .update(notification)
    .set({ readAt: new Date() })
    .where(
      and(
        mine(ctx),
        isNull(notification.readAt),
        parsed?.length ? inArray(notification.id, parsed) : undefined,
      ),
    );
}
