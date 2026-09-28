import { and, asc, eq, isNull, lt, sql } from "drizzle-orm";
import { domainEvent, type Db, type DbOrTx } from "@crm/db";
import { toAuditJson } from "./audit";
import type { RequestContext } from "./context";

export interface DomainEventInput {
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload?: Record<string, unknown>;
}

/**
 * Patrón outbox: el evento se inserta en la misma transacción que el cambio. El worker lo
 * entrega después. Así un evento nunca se pierde ni se emite para un cambio revertido.
 */
export async function emitEvent(tx: DbOrTx, ctx: RequestContext, event: DomainEventInput): Promise<void> {
  await tx.insert(domainEvent).values({
    organizationId: ctx.organizationId,
    type: event.type,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    payload: toAuditJson(event.payload ?? {}),
    actorUserId: ctx.userId,
  });
}

export interface PendingEvent {
  id: string;
  organizationId: string;
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: unknown;
  attempts: number;
}

export type EventHandler = (event: PendingEvent, db: Db) => Promise<void>;

export const MAX_EVENT_ATTEMPTS = 8;

/**
 * Procesa un lote de eventos pendientes. `FOR UPDATE SKIP LOCKED` permite correr varios
 * workers sin procesar dos veces el mismo evento. Devuelve cuántos se procesaron.
 */
export async function dispatchPendingEvents(
  db: Db,
  handlers: ReadonlyMap<string, readonly EventHandler[]>,
  batchSize = 50,
): Promise<number> {
  return db.transaction(async (tx) => {
    const batch = await tx
      .select()
      .from(domainEvent)
      .where(and(isNull(domainEvent.processedAt), lt(domainEvent.attempts, MAX_EVENT_ATTEMPTS)))
      .orderBy(asc(domainEvent.occurredAt))
      .limit(batchSize)
      .for("update", { skipLocked: true });

    for (const event of batch) {
      const list = handlers.get(event.type) ?? [];
      try {
        for (const handler of list) await handler(event, db);
        await tx
          .update(domainEvent)
          .set({ processedAt: sql`now()`, attempts: event.attempts + 1, lastError: null })
          .where(eq(domainEvent.id, event.id));
      } catch (error) {
        await tx
          .update(domainEvent)
          .set({
            attempts: event.attempts + 1,
            lastError: error instanceof Error ? error.message : String(error),
          })
          .where(eq(domainEvent.id, event.id));
      }
    }
    return batch.length;
  });
}
