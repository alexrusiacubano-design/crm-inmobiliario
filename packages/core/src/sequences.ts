import { sql } from "drizzle-orm";
import { sequence, type DbOrTx } from "@crm/db";

/** Prefijos de numeración conocidos. Se amplían en cada fase (PROP, OP, CTR, RES…). */
export const SEQUENCE_PREFIXES = ["PROP", "LEAD", "CAP", "OP", "RES", "CTR", "LIQ", "FAC", "TAS"] as const;
export type SequencePrefix = (typeof SEQUENCE_PREFIXES)[number];

/**
 * Reserva el siguiente número de forma atómica. El UPSERT bloquea la fila hasta que la
 * transacción termina: dos altas simultáneas nunca reciben el mismo número, y si la
 * transacción se revierte el número vuelve a quedar libre (sin huecos).
 */
export async function nextSequenceValue(
  tx: DbOrTx,
  organizationId: string,
  prefix: SequencePrefix,
): Promise<bigint> {
  const [row] = await tx
    .insert(sequence)
    .values({ organizationId, prefix, lastValue: 1n })
    .onConflictDoUpdate({
      target: [sequence.organizationId, sequence.prefix],
      set: { lastValue: sql`${sequence.lastValue} + 1` },
    })
    .returning({ value: sequence.lastValue });
  if (!row) throw new Error("No se pudo reservar la secuencia");
  return row.value;
}

export function formatCode(prefix: SequencePrefix, value: bigint, width = 6): string {
  return `${prefix}-${value.toString().padStart(width, "0")}`;
}

export async function nextCode(tx: DbOrTx, organizationId: string, prefix: SequencePrefix): Promise<string> {
  return formatCode(prefix, await nextSequenceValue(tx, organizationId, prefix));
}
