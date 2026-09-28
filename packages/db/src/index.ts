import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export { schema };
export * from "./schema";

export type Db = NodePgDatabase<typeof schema>;
/** Transacción de Drizzle: mismo API que `Db`. Los servicios reciben uno u otro. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

export interface DbHandle {
  db: Db;
  pool: pg.Pool;
}

export function createDb(connectionString: string, options: { max?: number } = {}): DbHandle {
  const pool = new pg.Pool({ connectionString, max: options.max ?? 10 });
  // Postgres devuelve bigint como string; la conversión a BigInt la hace Drizzle
  // en las columnas `mode: "bigint"`.
  const db = drizzle(pool, { schema, casing: "snake_case" });
  return { db, pool };
}

const globalForDb = globalThis as unknown as { __crmDb?: DbHandle };

/** Conexión compartida del proceso (evita abrir pools nuevos en cada recarga de desarrollo). */
export function getDb(): Db {
  if (!globalForDb.__crmDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL no está configurada");
    globalForDb.__crmDb = createDb(url);
  }
  return globalForDb.__crmDb.db;
}
