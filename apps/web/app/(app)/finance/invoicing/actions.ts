"use server";

import { revalidatePath } from "next/cache";
import { createInvoice, issueInvoice, voidInvoice } from "@crm/core";
import { runAction, type ActionResult } from "@/lib/actions";

const done = <T>(r: ActionResult<T>) => {
  if (r.ok) revalidatePath("/finance/invoicing");
  return r;
};

export async function createInvoiceAction(
  input: unknown,
): Promise<ActionResult<{ id: string; code: string }>> {
  return done(
    await runAction(async (db, ctx) => {
      const i = await createInvoice(db, ctx, input);
      return { id: i.id, code: i.code };
    }),
  );
}
export async function issueInvoiceAction(input: unknown): Promise<ActionResult<undefined>> {
  return done(await runAction(async (db, ctx) => void (await issueInvoice(db, ctx, input))));
}
export async function voidInvoiceAction(input: unknown): Promise<ActionResult<{ deleted: boolean }>> {
  return done(await runAction(async (db, ctx) => voidInvoice(db, ctx, input)));
}
