"use server";

import { revalidatePath } from "next/cache";
import {
  changeDealStage,
  collectCommission,
  createDeal,
  saveCommissionPlan,
  setDealCommissions,
  setDealParticipants,
  updateDeal,
} from "@crm/core";
import { runAction, type ActionResult } from "@/lib/actions";

// Todas las entradas llegan como `unknown`: cada servicio valida con Zod y verifica permisos.

function done<T>(r: ActionResult<T>): ActionResult<T> {
  if (r.ok) {
    for (const p of ["/commercial/deals", "/finance", "/performance", "/properties", "/crm"])
      revalidatePath(p, "layout");
    revalidatePath("/dashboard");
  }
  return r;
}

export async function createDealAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return done(await runAction(async (db, ctx) => ({ id: (await createDeal(db, ctx, input)).id })));
}

export async function updateDealAction(input: unknown): Promise<ActionResult<undefined>> {
  return done(
    await runAction(async (db, ctx) => {
      await updateDeal(db, ctx, input);
      return undefined;
    }),
  );
}
export async function changeDealStageAction(input: unknown): Promise<ActionResult<undefined>> {
  return done(
    await runAction(async (db, ctx) => {
      await changeDealStage(db, ctx, input);
      return undefined;
    }),
  );
}
export async function setDealCommissionsAction(input: unknown): Promise<ActionResult<undefined>> {
  return done(
    await runAction(async (db, ctx) => {
      await setDealCommissions(db, ctx, input);
      return undefined;
    }),
  );
}
export async function collectCommissionAction(input: unknown): Promise<ActionResult<undefined>> {
  return done(
    await runAction(async (db, ctx) => {
      await collectCommission(db, ctx, input);
      return undefined;
    }),
  );
}
export async function setDealParticipantsAction(input: unknown): Promise<ActionResult<undefined>> {
  return done(
    await runAction(async (db, ctx) => {
      await setDealParticipants(db, ctx, input);
      return undefined;
    }),
  );
}
export async function saveCommissionPlanAction(input: unknown): Promise<ActionResult<undefined>> {
  return done(
    await runAction(async (db, ctx) => {
      await saveCommissionPlan(db, ctx, input);
      return undefined;
    }),
  );
}
