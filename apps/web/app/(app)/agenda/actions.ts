"use server";

import { revalidatePath } from "next/cache";
import {
  closeEvent,
  createEvent,
  deleteEvent,
  globalSearch,
  reopenEvent,
  updateEvent,
  type SearchHit,
} from "@crm/core";
import { runAction, type ActionResult } from "@/lib/actions";

// Todas las entradas llegan como `unknown`: cada servicio valida con Zod y verifica permisos.

function done<T>(r: ActionResult<T>): ActionResult<T> {
  if (r.ok) {
    revalidatePath("/agenda", "layout");
    revalidatePath("/dashboard");
    revalidatePath("/crm", "layout");
    revalidatePath("/properties", "layout");
  }
  return r;
}

export async function createEventAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return done(await runAction(async (db, ctx) => ({ id: (await createEvent(db, ctx, input)).id })));
}

export async function updateEventAction(input: unknown): Promise<ActionResult<undefined>> {
  return done(
    await runAction(async (db, ctx) => {
      await updateEvent(db, ctx, input);
      return undefined;
    }),
  );
}

export async function closeEventAction(input: unknown): Promise<ActionResult<undefined>> {
  return done(
    await runAction(async (db, ctx) => {
      await closeEvent(db, ctx, input);
      return undefined;
    }),
  );
}

export async function reopenEventAction(input: unknown): Promise<ActionResult<undefined>> {
  return done(
    await runAction(async (db, ctx) => {
      await reopenEvent(db, ctx, input);
      return undefined;
    }),
  );
}

export async function deleteEventAction(id: string): Promise<ActionResult<undefined>> {
  return done(
    await runAction(async (db, ctx) => {
      await deleteEvent(db, ctx, id);
      return undefined;
    }),
  );
}

/** Buscador para vincular contactos y propiedades al evento (respeta el alcance del usuario). */
export async function searchLinksAction(
  q: string,
  kind: "contact" | "property",
): Promise<ActionResult<SearchHit[]>> {
  return runAction(async (db, ctx) =>
    (await globalSearch(db, ctx, { q })).filter((hit) => hit.entityType === kind).slice(0, 8),
  );
}
