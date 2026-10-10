"use server";

import { revalidatePath } from "next/cache";
import {
  addPropertyVideo,
  changeAcquisitionStage,
  changePropertyStatus,
  createAcquisition,
  createProperty,
  createValuation,
  deleteDocument,
  deletePropertyMedia,
  getStorage,
  listProperties,
  reorderPropertyMedia,
  setPrices,
  setPropertyCover,
  setPropertyExclusivity,
  setPropertyOwners,
  updateAcquisition,
  updateDocumentMeta,
  updateProperty,
  updatePropertyMedia,
} from "@crm/core";
import { runAction, type ActionResult } from "@/lib/actions";

// Todas las entradas llegan como `unknown`: cada servicio valida con Zod y verifica permisos.

function done<T>(r: ActionResult<T>, ...paths: string[]): ActionResult<T> {
  if (r.ok) for (const p of paths) revalidatePath(p, "layout");
  return r;
}

export async function createPropertyAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const r = await runAction(async (db, ctx) => ({ id: (await createProperty(db, ctx, input)).id }));
  return done(r, "/properties");
}

export async function updatePropertyAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const r = await runAction(async (db, ctx) => ({ id: (await updateProperty(db, ctx, input))?.id ?? "" }));
  return done(r, "/properties");
}

export async function setExclusivityAction(input: unknown): Promise<ActionResult<undefined>> {
  const r = await runAction(async (db, ctx) => {
    await setPropertyExclusivity(db, ctx, input);
    return undefined;
  });
  return done(r, "/properties");
}

export async function changePropertyStatusAction(input: unknown): Promise<ActionResult<undefined>> {
  const r = await runAction(async (db, ctx) => {
    await changePropertyStatus(db, ctx, input);
    return undefined;
  });
  return done(r, "/properties");
}

export async function setPricesAction(input: unknown): Promise<ActionResult<{ changed: number }>> {
  return done(await runAction((db, ctx) => setPrices(db, ctx, input)), "/properties");
}

export async function setOwnersAction(input: unknown): Promise<ActionResult<undefined>> {
  const r = await runAction(async (db, ctx) => {
    await setPropertyOwners(db, ctx, input);
    return undefined;
  });
  return done(r, "/properties", "/crm");
}

export async function addVideoAction(input: unknown): Promise<ActionResult<undefined>> {
  const r = await runAction(async (db, ctx) => {
    await addPropertyVideo(db, ctx, input);
    return undefined;
  });
  return done(r, "/properties");
}

export async function reorderMediaAction(input: unknown): Promise<ActionResult<undefined>> {
  return done(
    await runAction(async (db, ctx) => {
      await reorderPropertyMedia(db, ctx, input);
      return undefined;
    }),
    "/properties",
  );
}

export async function setCoverAction(mediaId: string): Promise<ActionResult<undefined>> {
  return done(
    await runAction(async (db, ctx) => {
      await setPropertyCover(db, ctx, mediaId);
      return undefined;
    }),
    "/properties",
  );
}

export async function updateMediaAction(input: unknown): Promise<ActionResult<undefined>> {
  return done(
    await runAction(async (db, ctx) => {
      await updatePropertyMedia(db, ctx, input);
      return undefined;
    }),
    "/properties",
  );
}

export async function deleteMediaAction(mediaId: string): Promise<ActionResult<undefined>> {
  return done(
    await runAction(async (db, ctx) => {
      await deletePropertyMedia(db, ctx, getStorage(), mediaId);
      return undefined;
    }),
    "/properties",
  );
}

export async function findPropertiesAction(
  q: string,
): Promise<ActionResult<{ id: string; code: string; displayTitle: string }[]>> {
  return runAction(async (db, ctx) => {
    const res = await listProperties(db, ctx, { q, pageSize: 8 });
    return res.items.map((i) => ({ id: i.id, code: i.code, displayTitle: i.displayTitle }));
  });
}

export async function createAcquisitionAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const r = await runAction(async (db, ctx) => ({ id: (await createAcquisition(db, ctx, input)).id }));
  return done(r, "/properties", "/crm");
}

export async function updateAcquisitionAction(input: unknown): Promise<ActionResult<undefined>> {
  const r = await runAction(async (db, ctx) => {
    await updateAcquisition(db, ctx, input);
    return undefined;
  });
  return done(r, "/properties");
}

export async function changeAcquisitionStageAction(
  input: unknown,
): Promise<ActionResult<{ propertyId: string | null }>> {
  const r = await runAction(async (db, ctx) => ({
    propertyId: (await changeAcquisitionStage(db, ctx, input))?.propertyId ?? null,
  }));
  return done(r, "/properties", "/crm");
}

export async function createValuationAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const r = await runAction(async (db, ctx) => ({ id: (await createValuation(db, ctx, input)).id }));
  return done(r, "/properties");
}

export async function updateDocumentAction(input: unknown): Promise<ActionResult<undefined>> {
  const r = await runAction(async (db, ctx) => {
    await updateDocumentMeta(db, ctx, input);
    return undefined;
  });
  return done(r, "/documents", "/properties", "/crm");
}

export async function deleteDocumentAction(id: string): Promise<ActionResult<undefined>> {
  return done(
    await runAction(async (db, ctx) => {
      await deleteDocument(db, ctx, id);
      return undefined;
    }),
    "/documents",
    "/properties",
    "/crm",
  );
}
