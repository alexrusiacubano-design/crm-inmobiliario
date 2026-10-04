"use server";

import { revalidatePath } from "next/cache";
import { inviteOwnerToPortal, revokePortalAccess } from "@crm/core";
import { runAction, type ActionResult } from "@/lib/actions";

export async function invitePortalAction(input: {
  contactId: string;
  email: string;
}): Promise<ActionResult<{ token: string }>> {
  const r = await runAction(async (db, ctx) => ({
    token: (await inviteOwnerToPortal(db, ctx, input)).token,
  }));
  if (r.ok) revalidatePath(`/crm/contacts/${input.contactId}`);
  return r;
}
export async function revokePortalAction(contactId: string): Promise<ActionResult<undefined>> {
  const r = await runAction(async (db, ctx) => void (await revokePortalAccess(db, ctx, contactId)));
  if (r.ok) revalidatePath(`/crm/contacts/${contactId}`);
  return r;
}
