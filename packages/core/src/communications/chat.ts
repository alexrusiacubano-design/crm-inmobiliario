import { and, asc, desc, eq, gt, inArray, lt, ne, sql } from "drizzle-orm";
import { chatConversation, chatMember, chatMessage, membership, user, type Db, type DbOrTx } from "@crm/db";
import { chatMessageSchema, chatStartSchema } from "@crm/shared/validation/communications";
import { uuidSchema } from "@crm/shared/validation";
import { requirePermission, type RequestContext } from "../context";
import { NotFoundError, ValidationError, parseInput } from "../errors";

async function assertMember(tx: DbOrTx, ctx: RequestContext, conversationId: string) {
  const [m] = await tx
    .select({ c: chatConversation })
    .from(chatMember)
    .innerJoin(chatConversation, eq(chatConversation.id, chatMember.conversationId))
    .where(
      and(
        eq(chatMember.conversationId, conversationId),
        eq(chatMember.userId, ctx.userId),
        eq(chatConversation.organizationId, ctx.organizationId),
      ),
    );
  if (!m) throw new NotFoundError("Conversación");
  return m.c;
}

/** Directa (1 persona, sin título) o grupo. Las directas no se duplican. */
export async function startConversation(db: Db, ctx: RequestContext, rawInput: unknown) {
  requirePermission(ctx, "communication.read");
  const input = parseInput(chatStartSchema, rawInput);
  const others = [...new Set(input.memberIds.filter((id) => id !== ctx.userId))];
  if (!others.length) throw new ValidationError("Elegí al menos otra persona", { memberIds: ["Requerido"] });
  const isGroup = others.length > 1 || Boolean(input.title);
  if (isGroup && !input.title) throw new ValidationError("Poné un nombre al grupo", { title: ["Requerido"] });
  return db.transaction(async (tx) => {
    const active = await tx
      .select({ userId: membership.userId })
      .from(membership)
      .where(
        and(
          eq(membership.organizationId, ctx.organizationId),
          eq(membership.status, "active"),
          inArray(membership.userId, others),
        ),
      );
    if (active.length !== others.length)
      throw new ValidationError("Hay personas que no son usuarios activos", { memberIds: ["Inválido"] });
    const directKey = isGroup ? null : [ctx.userId, others[0]].sort().join(":");
    if (directKey) {
      const [existing] = await tx
        .select()
        .from(chatConversation)
        .where(
          and(
            eq(chatConversation.organizationId, ctx.organizationId),
            eq(chatConversation.directKey, directKey),
          ),
        );
      if (existing) return existing;
    }
    const [conv] = await tx
      .insert(chatConversation)
      .values({
        organizationId: ctx.organizationId,
        isGroup,
        title: input.title,
        directKey,
        createdById: ctx.userId,
      })
      .returning();
    if (!conv) throw new Error("No se pudo crear la conversación");
    await tx
      .insert(chatMember)
      .values([ctx.userId, ...others].map((userId) => ({ conversationId: conv.id, userId })));
    return conv;
  });
}

export async function sendChatMessage(db: Db, ctx: RequestContext, rawInput: unknown) {
  requirePermission(ctx, "communication.read");
  const input = parseInput(chatMessageSchema, rawInput);
  return db.transaction(async (tx) => {
    await assertMember(tx, ctx, input.conversationId);
    const [msg] = await tx
      .insert(chatMessage)
      .values({
        organizationId: ctx.organizationId,
        conversationId: input.conversationId,
        authorUserId: ctx.userId,
        body: input.body,
      })
      .returning();
    const now = msg?.createdAt ?? new Date();
    await tx
      .update(chatConversation)
      .set({ lastMessageAt: now })
      .where(eq(chatConversation.id, input.conversationId));
    await tx
      .update(chatMember)
      .set({ lastReadAt: now })
      .where(and(eq(chatMember.conversationId, input.conversationId), eq(chatMember.userId, ctx.userId)));
    return msg;
  });
}

/** Mis conversaciones con último mensaje y no leídos. */
export async function listConversations(db: DbOrTx, ctx: RequestContext) {
  requirePermission(ctx, "communication.read");
  const mine = await db
    .select({ c: chatConversation, lastReadAt: chatMember.lastReadAt })
    .from(chatMember)
    .innerJoin(chatConversation, eq(chatConversation.id, chatMember.conversationId))
    .where(and(eq(chatMember.userId, ctx.userId), eq(chatConversation.organizationId, ctx.organizationId)))
    .orderBy(desc(sql`coalesce(${chatConversation.lastMessageAt}, ${chatConversation.createdAt})`));
  if (!mine.length) return [];
  const ids = mine.map((m) => m.c.id);
  const [members, last, unread] = await Promise.all([
    db
      .select({ conversationId: chatMember.conversationId, userId: user.id, name: user.name })
      .from(chatMember)
      .innerJoin(user, eq(user.id, chatMember.userId))
      .where(inArray(chatMember.conversationId, ids)),
    db
      .selectDistinctOn([chatMessage.conversationId], {
        conversationId: chatMessage.conversationId,
        body: chatMessage.body,
        authorUserId: chatMessage.authorUserId,
        createdAt: chatMessage.createdAt,
      })
      .from(chatMessage)
      .where(inArray(chatMessage.conversationId, ids))
      .orderBy(chatMessage.conversationId, desc(chatMessage.createdAt)),
    db
      .select({ conversationId: chatMessage.conversationId, n: sql<number>`count(*)::int` })
      .from(chatMessage)
      .innerJoin(
        chatMember,
        and(eq(chatMember.conversationId, chatMessage.conversationId), eq(chatMember.userId, ctx.userId)),
      )
      .where(
        and(
          inArray(chatMessage.conversationId, ids),
          ne(chatMessage.authorUserId, ctx.userId),
          sql`(${chatMember.lastReadAt} is null or ${chatMessage.createdAt} > ${chatMember.lastReadAt})`,
        ),
      )
      .groupBy(chatMessage.conversationId),
  ]);
  return mine.map(({ c }) => {
    const people = members.filter((m) => m.conversationId === c.id);
    const others = people.filter((p) => p.userId !== ctx.userId);
    const lm = last.find((l) => l.conversationId === c.id);
    return {
      id: c.id,
      isGroup: c.isGroup,
      title: c.isGroup ? (c.title ?? "Grupo") : (others[0]?.name ?? "Conversación"),
      members: people.map((p) => ({ userId: p.userId, name: p.name })),
      lastMessage: lm
        ? {
            body: lm.body,
            mine: lm.authorUserId === ctx.userId,
            author: people.find((p) => p.userId === lm.authorUserId)?.name ?? "",
            createdAt: lm.createdAt,
          }
        : null,
      unread: unread.find((u) => u.conversationId === c.id)?.n ?? 0,
    };
  });
}

/** Mensajes (los 100 más recientes, o los nuevos después de `after`) y marca como leído. */
export async function conversationMessages(
  db: Db,
  ctx: RequestContext,
  conversationId: string,
  opts: { after?: Date; before?: Date } = {},
) {
  requirePermission(ctx, "communication.read");
  const id = parseInput(uuidSchema, conversationId);
  await assertMember(db, ctx, id);
  const rows = await db
    .select({ m: chatMessage, author: user.name })
    .from(chatMessage)
    .innerJoin(user, eq(user.id, chatMessage.authorUserId))
    .where(
      and(
        eq(chatMessage.conversationId, id),
        opts.after ? gt(chatMessage.createdAt, opts.after) : undefined,
        opts.before ? lt(chatMessage.createdAt, opts.before) : undefined,
      ),
    )
    .orderBy(desc(chatMessage.createdAt))
    .limit(100);
  await db
    .update(chatMember)
    .set({ lastReadAt: new Date() })
    .where(and(eq(chatMember.conversationId, id), eq(chatMember.userId, ctx.userId)));
  return rows.reverse().map((r) => ({ ...r.m, authorName: r.author, mine: r.m.authorUserId === ctx.userId }));
}

/** Total de mensajes sin leer (menú y dashboard). */
export async function unreadChatCount(db: DbOrTx, ctx: RequestContext): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(chatMessage)
    .innerJoin(
      chatMember,
      and(eq(chatMember.conversationId, chatMessage.conversationId), eq(chatMember.userId, ctx.userId)),
    )
    .where(
      and(
        eq(chatMessage.organizationId, ctx.organizationId),
        ne(chatMessage.authorUserId, ctx.userId),
        sql`(${chatMember.lastReadAt} is null or ${chatMessage.createdAt} > ${chatMember.lastReadAt})`,
      ),
    );
  return r?.n ?? 0;
}

/** Personas con las que se puede chatear. */
export async function chatPeople(db: DbOrTx, ctx: RequestContext) {
  requirePermission(ctx, "communication.read");
  return db
    .select({ userId: user.id, name: user.name })
    .from(membership)
    .innerJoin(user, eq(user.id, membership.userId))
    .where(
      and(
        eq(membership.organizationId, ctx.organizationId),
        eq(membership.status, "active"),
        ne(membership.userId, ctx.userId),
      ),
    )
    .orderBy(asc(user.name));
}
