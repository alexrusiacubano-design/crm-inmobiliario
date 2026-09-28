"use server";

import { revalidatePath } from "next/cache";
import {
  addContactDate,
  addContactRelation,
  assignLead,
  deleteContactDate,
  removeContactRelation,
  changeLeadStatus,
  createContact,
  createLead,
  deleteContact,
  dismissDuplicate,
  globalSearch,
  listContacts,
  listTimeline,
  logInteraction,
  mergeContacts,
  revealAccountNumber,
  saveSearchProfile,
  updateContact,
  upsertOwnerProfile,
  type SearchHit,
} from "@crm/core";
import { runAction, type ActionResult } from "@/lib/actions";

// Todas las entradas llegan como `unknown`: cada servicio valida con Zod y verifica permisos.

type Duplicates = { contactId: string | null; displayName: string; reasons: string[]; score: number }[];

export async function createContactAction(
  input: unknown,
): Promise<ActionResult<{ id: string; duplicates: Duplicates }>> {
  const r = await runAction(async (db, ctx) => {
    const { contact, duplicates } = await createContact(db, ctx, input);
    return { id: contact.id, duplicates };
  });
  if (r.ok) revalidatePath("/crm", "layout");
  return r;
}

export async function updateContactAction(
  input: unknown,
): Promise<ActionResult<{ id: string; duplicates: Duplicates }>> {
  const r = await runAction(async (db, ctx) => {
    const { contact, duplicates } = await updateContact(db, ctx, input);
    return { id: contact?.id ?? "", duplicates };
  });
  if (r.ok) revalidatePath("/crm", "layout");
  return r;
}

export async function deleteContactAction(id: string): Promise<ActionResult<undefined>> {
  const r = await runAction(async (db, ctx) => {
    await deleteContact(db, ctx, id);
    return undefined;
  });
  if (r.ok) revalidatePath("/crm", "layout");
  return r;
}

export async function findContactsAction(
  q: string,
): Promise<ActionResult<{ id: string; displayName: string; phone: string | null; email: string | null }[]>> {
  return runAction(async (db, ctx) => {
    const res = await listContacts(db, ctx, { q, pageSize: 8 });
    return res.items.map((i) => ({ id: i.id, displayName: i.displayName, phone: i.phone, email: i.email }));
  });
}

export async function createLeadAction(
  input: unknown,
): Promise<ActionResult<{ id: string; duplicates: Duplicates }>> {
  const r = await runAction(async (db, ctx) => {
    const { lead, duplicates } = await createLead(db, ctx, input);
    return { id: lead.id, duplicates };
  });
  if (r.ok) revalidatePath("/crm", "layout");
  return r;
}

export async function changeLeadStatusAction(input: unknown): Promise<ActionResult<undefined>> {
  const r = await runAction(async (db, ctx) => {
    await changeLeadStatus(db, ctx, input);
    return undefined;
  });
  if (r.ok) revalidatePath("/crm", "layout");
  return r;
}

export async function assignLeadAction(input: unknown): Promise<ActionResult<undefined>> {
  const r = await runAction(async (db, ctx) => {
    await assignLead(db, ctx, input);
    return undefined;
  });
  if (r.ok) revalidatePath("/crm", "layout");
  return r;
}

export async function saveSearchProfileAction(input: unknown): Promise<ActionResult<undefined>> {
  const r = await runAction(async (db, ctx) => {
    await saveSearchProfile(db, ctx, input);
    return undefined;
  });
  if (r.ok) revalidatePath("/crm", "layout");
  return r;
}

export async function logInteractionAction(input: unknown): Promise<ActionResult<undefined>> {
  const r = await runAction(async (db, ctx) => {
    await logInteraction(db, ctx, input);
    return undefined;
  });
  if (r.ok) revalidatePath("/crm", "layout");
  return r;
}

export async function loadTimelineAction(query: unknown) {
  return runAction(async (db, ctx) => {
    const res = await listTimeline(db, ctx, query);
    return {
      nextCursor: res.nextCursor,
      items: res.items.map((i) => ({ ...i, occurredAt: i.occurredAt.toISOString() })),
    };
  });
}

export async function saveOwnerProfileAction(input: unknown): Promise<ActionResult<undefined>> {
  const r = await runAction(async (db, ctx) => {
    await upsertOwnerProfile(db, ctx, input);
    return undefined;
  });
  if (r.ok) revalidatePath("/crm", "layout");
  return r;
}

export async function revealAccountAction(contactId: string): Promise<ActionResult<string | null>> {
  return runAction((db, ctx) => revealAccountNumber(db, ctx, contactId));
}

export async function mergeContactsAction(input: unknown): Promise<ActionResult<{ survivorId: string }>> {
  const r = await runAction((db, ctx) => mergeContacts(db, ctx, input));
  if (r.ok) revalidatePath("/crm", "layout");
  return r;
}

export async function dismissDuplicateAction(candidateId: string): Promise<ActionResult<undefined>> {
  const r = await runAction(async (db, ctx) => {
    await dismissDuplicate(db, ctx, candidateId);
    return undefined;
  });
  if (r.ok) revalidatePath("/crm", "layout");
  return r;
}

export async function globalSearchAction(q: string): Promise<ActionResult<SearchHit[]>> {
  return runAction((db, ctx) => globalSearch(db, ctx, { q }));
}

function crmDone<T>(r: ActionResult<T>): ActionResult<T> {
  if (r.ok) {
    revalidatePath("/crm", "layout");
    revalidatePath("/dashboard");
  }
  return r;
}

export async function addContactDateAction(input: unknown): Promise<ActionResult<undefined>> {
  return crmDone(
    await runAction(async (db, ctx) => {
      await addContactDate(db, ctx, input);
      return undefined;
    }),
  );
}

export async function deleteContactDateAction(id: string): Promise<ActionResult<undefined>> {
  return crmDone(
    await runAction(async (db, ctx) => {
      await deleteContactDate(db, ctx, id);
      return undefined;
    }),
  );
}

export async function addContactRelationAction(input: unknown): Promise<ActionResult<undefined>> {
  return crmDone(
    await runAction(async (db, ctx) => {
      await addContactRelation(db, ctx, input);
      return undefined;
    }),
  );
}

export async function removeContactRelationAction(id: string): Promise<ActionResult<undefined>> {
  return crmDone(
    await runAction(async (db, ctx) => {
      await removeContactRelation(db, ctx, id);
      return undefined;
    }),
  );
}
