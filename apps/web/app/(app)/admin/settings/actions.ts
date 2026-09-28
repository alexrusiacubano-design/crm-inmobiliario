"use server";

import { revalidatePath } from "next/cache";
import { updateOrganization } from "@crm/core";
import { runAction, type ActionResult } from "@/lib/actions";

export async function saveSettingsAction(input: unknown): Promise<ActionResult<undefined>> {
  const result = await runAction(async (db, ctx) => {
    await updateOrganization(db, ctx, input);
    return undefined;
  });
  if (result.ok) revalidatePath("/", "layout");
  return result;
}
