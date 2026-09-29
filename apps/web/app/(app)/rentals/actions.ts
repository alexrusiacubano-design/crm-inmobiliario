"use server";

import { revalidatePath } from "next/cache";
import { applyAdjustment, closeContract, createContract, renewContract } from "@crm/core";
import { runAction, type ActionResult } from "@/lib/actions";

function done<T>(r: ActionResult<T>): ActionResult<T> {
  if (r.ok) {
    for (const p of ["/rentals", "/properties", "/commercial", "/crm"]) revalidatePath(p, "layout");
    revalidatePath("/dashboard");
  }
  return r;
}

export async function createContractAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return done(await runAction(async (db, ctx) => ({ id: (await createContract(db, ctx, input)).id })));
}
export async function applyAdjustmentAction(input: unknown): Promise<ActionResult<undefined>> {
  return done(await runAction(async (db, ctx) => void (await applyAdjustment(db, ctx, input))));
}
export async function renewContractAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return done(await runAction(async (db, ctx) => ({ id: (await renewContract(db, ctx, input)).id })));
}
export async function closeContractAction(input: unknown): Promise<ActionResult<undefined>> {
  return done(await runAction(async (db, ctx) => void (await closeContract(db, ctx, input))));
}
