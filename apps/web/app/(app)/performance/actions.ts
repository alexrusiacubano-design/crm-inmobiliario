"use server";

import { revalidatePath } from "next/cache";
import { saveGoals } from "@crm/core";
import { runAction, type ActionResult } from "@/lib/actions";

export async function saveGoalsAction(input: unknown): Promise<ActionResult<undefined>> {
  const r = await runAction(async (db, ctx) => {
    await saveGoals(db, ctx, input);
    return undefined;
  });
  if (r.ok) revalidatePath("/performance", "layout");
  return r;
}
