"use server";

import { revalidatePath } from "next/cache";
import { deleteRule, runScheduleNow, saveRule, setRuleEnabled } from "@crm/core";
import { runAction, type ActionResult } from "@/lib/actions";

function done<T>(r: ActionResult<T>): ActionResult<T> {
  if (r.ok) revalidatePath("/admin/automations");
  return r;
}

export async function saveRuleAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return done(await runAction(async (db, ctx) => ({ id: (await saveRule(db, ctx, input)).id })));
}
export async function setRuleEnabledAction(id: string, enabled: boolean): Promise<ActionResult<undefined>> {
  return done(await runAction(async (db, ctx) => void (await setRuleEnabled(db, ctx, id, enabled))));
}
export async function deleteRuleAction(id: string): Promise<ActionResult<undefined>> {
  return done(await runAction(async (db, ctx) => void (await deleteRule(db, ctx, id))));
}
export async function runScheduleNowAction(): Promise<ActionResult<{ rules: number; runs: number }>> {
  return done(await runAction(async (db, ctx) => runScheduleNow(db, ctx)));
}
