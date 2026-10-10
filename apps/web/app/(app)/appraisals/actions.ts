"use server";

import { deleteAppraisal, saveAppraisal } from "@crm/core";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/actions";

export async function saveAppraisalAction(
  input: unknown,
): Promise<ActionResult<{ id: string; code: string }>> {
  const r = await runAction(async (db, ctx) => {
    const row = await saveAppraisal(db, ctx, input);
    return { id: row.id, code: row.code };
  });
  if (r.ok) revalidatePath("/appraisals", "layout");
  return r;
}

export async function deleteAppraisalAction(id: string): Promise<ActionResult<undefined>> {
  const r = await runAction(async (db, ctx) => {
    await deleteAppraisal(db, ctx, id);
    return undefined;
  });
  if (r.ok) revalidatePath("/appraisals", "layout");
  return r;
}
