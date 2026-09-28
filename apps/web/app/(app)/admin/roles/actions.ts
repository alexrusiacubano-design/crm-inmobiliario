"use server";

import { revalidatePath } from "next/cache";
import { createRole, deleteRole, updateRole } from "@crm/core";
import { runAction, type ActionResult } from "@/lib/actions";

export async function saveRoleAction(
  input: { id?: string } & Record<string, unknown>,
): Promise<ActionResult<{ id: string }>> {
  const result = await runAction(async (db, ctx) => {
    const row = input.id ? await updateRole(db, ctx, input) : await createRole(db, ctx, input);
    return { id: row.id };
  });
  if (result.ok) revalidatePath("/admin/roles");
  return result;
}

export async function deleteRoleAction(roleId: string): Promise<ActionResult<undefined>> {
  const result = await runAction(async (db, ctx) => {
    await deleteRole(db, ctx, roleId);
    return undefined;
  });
  if (result.ok) revalidatePath("/admin/roles");
  return result;
}
