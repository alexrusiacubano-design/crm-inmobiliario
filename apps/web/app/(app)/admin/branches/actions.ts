"use server";

import { revalidatePath } from "next/cache";
import { createBranch, updateBranch } from "@crm/core";
import { runAction, type ActionResult } from "@/lib/actions";

export async function saveBranchAction(
  input: { id?: string } & Record<string, unknown>,
): Promise<ActionResult<{ id: string }>> {
  const result = await runAction(async (db, ctx) => {
    const row = input.id ? await updateBranch(db, ctx, input) : await createBranch(db, ctx, input);
    if (!row) throw new Error("Sucursal no guardada");
    return { id: row.id };
  });
  if (result.ok) revalidatePath("/admin/branches");
  return result;
}
