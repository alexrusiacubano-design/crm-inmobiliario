import {
  chatPeople,
  conversationMessages,
  listConversations,
  NotFoundError,
  ValidationError,
} from "@crm/core";
import { getDb } from "@crm/db";
import { MessagesSquare } from "lucide-react";
import type { Metadata } from "next";
import { ChatThread, ConversationList, NewConversationButton } from "@/components/communications/chat";
import { Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { requirePagePermission } from "@/lib/session";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Mensajes internos" };

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { ctx } = await requirePagePermission("communication.read");
  const params = await searchParams;
  const db = getDb();
  const [conversations, people] = await Promise.all([listConversations(db, ctx), chatPeople(db, ctx)]);
  const activeId = params.c ?? conversations[0]?.id ?? null;
  const active = conversations.find((c) => c.id === activeId) ?? null;
  const messages = active
    ? await conversationMessages(db, ctx, active.id).catch((e: unknown) => {
        if (e instanceof NotFoundError || e instanceof ValidationError) return [];
        throw e;
      })
    : [];

  return (
    <>
      <PageHeader
        title="Mensajes internos"
        description="Chat del equipo: directos y grupos. Solo lo ven quienes participan."
      />
      <Card className="grid overflow-hidden md:grid-cols-[18rem_1fr]">
        <div className="border-b md:border-r md:border-b-0">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-semibold">Conversaciones</span>
            <NewConversationButton people={people} />
          </div>
          <ConversationList
            activeId={active?.id ?? null}
            items={conversations.map((c) => ({
              id: c.id,
              title: c.title,
              isGroup: c.isGroup,
              unread: c.id === active?.id ? 0 : c.unread,
              lastMessage: c.lastMessage
                ? {
                    body: c.lastMessage.body,
                    mine: c.lastMessage.mine,
                    author: c.lastMessage.author,
                    at: c.lastMessage.createdAt.toISOString(),
                  }
                : null,
            }))}
          />
        </div>
        {active ? (
          <ChatThread
            conversationId={active.id}
            title={active.title}
            members={active.members.map((m) => m.name).join(", ")}
            initial={messages.map((m) => ({
              id: m.id,
              body: m.body,
              authorName: m.authorName,
              mine: m.mine,
              createdAt: m.createdAt.toISOString(),
              timeLabel: formatDateTime(m.createdAt),
            }))}
          />
        ) : (
          <EmptyState
            icon={MessagesSquare}
            title="Elegí o creá una conversación"
            description="Usá “Nueva” para escribirle a alguien del equipo."
          />
        )}
      </Card>
    </>
  );
}
