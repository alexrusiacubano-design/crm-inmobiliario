"use server";

import { revalidatePath } from "next/cache";
import {
  createMember,
  getMember,
  resetMemberPassword,
  setMemberStatus,
  updateMember,
  type MemberSnapshot,
} from "@crm/core";
import { runAction, type ActionResult } from "@/lib/actions";

// Las entradas llegan como `unknown` a propósito: cada servicio valida con Zod en el servidor.

export async function createUserAction(input: unknown): Promise<ActionResult<{ membershipId: string }>> {
  const result = await runAction(async (db, ctx) => {
    const created = await createMember(db, ctx, input);
    return { membershipId: created.membershipId };
  });
  if (result.ok) revalidatePath("/admin/users");
  return result;
}

export async function updateUserAction(input: unknown): Promise<ActionResult<{ membershipId: string }>> {
  const result = await runAction(async (db, ctx) => {
    const updated = await updateMember(db, ctx, input);
    return { membershipId: updated.membershipId };
  });
  if (result.ok) revalidatePath("/admin/users");
  return result;
}

export async function getUserAction(membershipId: string): Promise<ActionResult<MemberSnapshot>> {
  return runAction((db, ctx) => getMember(db, ctx, membershipId));
}

export async function setUserStatusAction(input: unknown): Promise<ActionResult<{ status: string }>> {
  const result = await runAction(async (db, ctx) => {
    const updated = await setMemberStatus(db, ctx, input);
    return { status: updated.status };
  });
  if (result.ok) revalidatePath("/admin/users");
  return result;
}

export async function resetPasswordAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction(async (db, ctx) => {
    await resetMemberPassword(db, ctx, input);
    return undefined;
  });
}
