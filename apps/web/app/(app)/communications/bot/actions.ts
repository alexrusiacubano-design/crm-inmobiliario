"use server";

import { revalidatePath } from "next/cache";
import { rotateBotToken, saveBotSettings } from "@crm/core";
import { runAction, type ActionResult } from "@/lib/actions";

export async function saveBotSettingsAction(input: unknown): Promise<ActionResult<undefined>> {
  const r = await runAction(async (db, ctx) => void (await saveBotSettings(db, ctx, input)));
  if (r.ok) revalidatePath("/communications/bot");
  return r;
}
export async function rotateBotTokenAction(): Promise<ActionResult<undefined>> {
  const r = await runAction(async (db, ctx) => void (await rotateBotToken(db, ctx)));
  if (r.ok) revalidatePath("/communications/bot");
  return r;
}
