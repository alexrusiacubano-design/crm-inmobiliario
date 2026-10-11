"use server";

import { publishSite, saveSiteDraft } from "@crm/core";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/actions";

export async function saveSiteDraftAction(input: unknown): Promise<ActionResult<undefined>> {
  const r = await runAction(async (db, ctx) => {
    await saveSiteDraft(db, ctx, input);
    return undefined;
  });
  if (r.ok) revalidatePath("/admin/website");
  return r;
}

export async function publishSiteAction(input: unknown): Promise<ActionResult<undefined>> {
  const r = await runAction(async (db, ctx) => {
    await saveSiteDraft(db, ctx, input);
    await publishSite(db, ctx);
    return undefined;
  });
  if (r.ok) {
    revalidatePath("/admin/website");
    revalidatePath("/", "layout");
  }
  return r;
}
