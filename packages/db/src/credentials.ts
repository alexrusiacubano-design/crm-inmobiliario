import { and, eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import type { DbOrTx } from "./index";
import { account, user } from "./schema";

/**
 * Crea un usuario con credencial email + contraseña en el mismo formato que Better Auth
 * (hash scrypt en `account.password`, provider "credential"). Lo usan el alta de usuarios
 * desde Administración y el seed; el registro público está deshabilitado.
 */
export async function insertCredentialUser(
  db: DbOrTx,
  input: { name: string; email: string; password: string },
): Promise<{ id: string }> {
  const [created] = await db
    .insert(user)
    .values({ name: input.name, email: input.email.toLowerCase(), emailVerified: true })
    .returning({ id: user.id });
  if (!created) throw new Error("No se pudo crear el usuario");
  await db.insert(account).values({
    userId: created.id,
    accountId: created.id,
    providerId: "credential",
    password: await hashPassword(input.password),
  });
  return created;
}

export async function setCredentialPassword(db: DbOrTx, userId: string, password: string): Promise<void> {
  const hashed = await hashPassword(password);
  const updated = await db
    .update(account)
    .set({ password: hashed })
    .where(and(eq(account.userId, userId), eq(account.providerId, "credential")))
    .returning({ id: account.id });
  if (updated.length === 0) {
    await db
      .insert(account)
      .values({ userId, accountId: userId, providerId: "credential", password: hashed });
  }
}
