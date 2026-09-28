import pg from "pg";
import { runMigrations } from "./migrate";
import { createDb, type DbHandle } from "./index";
import { syncPermissions } from "./seed/catalog";

/**
 * Deja la base de tests en blanco y migrada. Solo acepta bases cuyo nombre termina en
 * "_test" para evitar borrar una base real por error.
 */
export async function prepareTestDatabase(connectionString: string): Promise<DbHandle> {
  const dbName = new URL(connectionString).pathname.replace(/^\//, "");
  if (!dbName.endsWith("_test")) {
    throw new Error(`prepareTestDatabase se niega a limpiar "${dbName}": el nombre debe terminar en _test`);
  }
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
  } finally {
    await client.end();
  }
  await runMigrations(connectionString);
  const handle = createDb(connectionString, { max: 20 });
  await syncPermissions(handle.db);
  return handle;
}
