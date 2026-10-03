"use server";

import { revalidatePath } from "next/cache";
import {
  actOnInquiry,
  composeContext,
  conversationMessages,
  convertInquiry,
  createInquiry,
  listTemplates,
  logOutbound,
  saveTemplate,
  sendChatMessage,
  startConversation,
} from "@crm/core";
import type { TemplateChannel, TemplateVariable } from "@crm/shared/communications";
import { runAction, type ActionResult } from "@/lib/actions";
import { formatDateTime } from "@/lib/utils";

function done<T>(r: ActionResult<T>, ...paths: string[]): ActionResult<T> {
  if (r.ok) for (const p of paths) revalidatePath(p, "layout");
  return r;
}

export async function createInquiryAction(input: unknown): Promise<ActionResult<undefined>> {
  return done(
    await runAction(async (db, ctx) => void (await createInquiry(db, ctx, input))),
    "/communications",
    "/dashboard",
  );
}
export async function actOnInquiryAction(input: unknown): Promise<ActionResult<undefined>> {
  return done(
    await runAction(async (db, ctx) => void (await actOnInquiry(db, ctx, input))),
    "/communications",
    "/dashboard",
  );
}
export async function convertInquiryAction(input: unknown): Promise<ActionResult<{ leadId: string }>> {
  return done(
    await runAction(async (db, ctx) => ({ leadId: (await convertInquiry(db, ctx, input)).leadId })),
    "/communications",
    "/crm",
    "/dashboard",
  );
}

export async function startConversationAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return done(
    await runAction(async (db, ctx) => ({ id: (await startConversation(db, ctx, input)).id })),
    "/communications/chat",
  );
}
export async function sendChatMessageAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction(async (db, ctx) => void (await sendChatMessage(db, ctx, input)));
}

export interface ChatMessageView {
  id: string;
  body: string;
  authorName: string;
  mine: boolean;
  createdAt: string;
  /** Formateada en el servidor para evitar diferencias de hidratación. */
  timeLabel: string;
}
/** Mensajes nuevos de una conversación (lo usa el chat cada pocos segundos). */
export async function chatMessagesAction(
  conversationId: string,
  after?: string | null,
): Promise<ActionResult<ChatMessageView[]>> {
  return runAction(async (db, ctx) =>
    (await conversationMessages(db, ctx, conversationId, { after: after ? new Date(after) : undefined })).map(
      (m) => ({
        id: m.id,
        body: m.body,
        authorName: m.authorName,
        mine: m.mine,
        createdAt: m.createdAt.toISOString(),
        timeLabel: formatDateTime(m.createdAt),
      }),
    ),
  );
}

export async function saveTemplateAction(input: unknown): Promise<ActionResult<undefined>> {
  return done(
    await runAction(async (db, ctx) => void (await saveTemplate(db, ctx, input))),
    "/communications",
  );
}

export interface ComposeData {
  displayName: string;
  whatsapp: string | null;
  email: string | null;
  values: Partial<Record<TemplateVariable, string>>;
  templates: { id: string; name: string; subject: string | null; body: string }[];
}
export async function composeDataAction(input: {
  contactId: string;
  propertyId?: string | null;
  channel: TemplateChannel;
}): Promise<ActionResult<ComposeData>> {
  return runAction(async (db, ctx) => {
    const [c, templates] = await Promise.all([
      composeContext(db, ctx, { contactId: input.contactId, propertyId: input.propertyId }),
      listTemplates(db, ctx, { channel: input.channel }),
    ]);
    return {
      ...c,
      templates: templates.map((t) => ({ id: t.id, name: t.name, subject: t.subject, body: t.body })),
    };
  });
}
export async function logOutboundAction(input: unknown): Promise<ActionResult<undefined>> {
  return done(await runAction(async (db, ctx) => void (await logOutbound(db, ctx, input))), "/crm");
}
