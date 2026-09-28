"use server";

import { revalidatePath } from "next/cache";
import { createTeam, listTeamMembers, setTeamMembers, updateTeam } from "@crm/core";
import { runAction, type ActionResult } from "@/lib/actions";

export async function saveTeamAction(
  input: { id?: string } & Record<string, unknown>,
): Promise<ActionResult<{ id: string }>> {
  const result = await runAction(async (db, ctx) => {
    const row = input.id ? await updateTeam(db, ctx, input) : await createTeam(db, ctx, input);
    if (!row) throw new Error("Equipo no guardado");
    return { id: row.id };
  });
  if (result.ok) revalidatePath("/admin/teams");
  return result;
}

export async function getTeamMembersAction(teamId: string): Promise<ActionResult<string[]>> {
  return runAction(async (db, ctx) => (await listTeamMembers(db, ctx, teamId)).map((m) => m.membershipId));
}

export async function setTeamMembersAction(input: unknown): Promise<ActionResult<undefined>> {
  const result = await runAction(async (db, ctx) => {
    await setTeamMembers(db, ctx, input);
    return undefined;
  });
  if (result.ok) revalidatePath("/admin/teams");
  return result;
}
