"use client";

import { MessageSquarePlus, Send, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  chatMessagesAction,
  sendChatMessageAction,
  startConversationAction,
  type ChatMessageView,
} from "@/app/(app)/communications/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/form";
import { cn, initials } from "@/lib/utils";

export interface ConversationView {
  id: string;
  title: string;
  isGroup: boolean;
  unread: number;
  lastMessage: { body: string; mine: boolean; author: string; at: string } | null;
}

export function NewConversationButton({ people }: { people: { userId: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();
  const group = selected.length > 1;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" onClick={() => setOpen(true)}>
        <MessageSquarePlus /> Nueva
      </Button>
      <DialogContent
        title="Nueva conversación"
        description="Elegí una persona para un chat directo o varias para un grupo."
      >
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await startConversationAction({ memberIds: selected, title: group ? title : null });
              if (!r.ok) return void toast.error(r.error);
              setOpen(false);
              setSelected([]);
              setTitle("");
              router.push(`/communications/chat?c=${r.data.id}`);
            });
          }}
        >
          <Input placeholder="Buscar persona…" value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="max-h-64 overflow-y-auto rounded-md border">
            {people
              .filter((p) => p.name.toLowerCase().includes(q.toLowerCase()))
              .map((p) => (
                <li key={p.userId}>
                  <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-surface-muted">
                    <Checkbox
                      checked={selected.includes(p.userId)}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked ? [...selected, p.userId] : selected.filter((x) => x !== p.userId),
                        )
                      }
                    />
                    {p.name}
                  </label>
                </li>
              ))}
          </ul>
          {group && (
            <Field label="Nombre del grupo" htmlFor="cg-t">
              <Input
                id="cg-t"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Guardia del sábado"
              />
            </Field>
          )}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending} disabled={!selected.length || (group && !title.trim())}>
              {group ? "Crear grupo" : "Abrir chat"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ConversationList({
  items,
  activeId,
}: {
  items: ConversationView[];
  activeId: string | null;
}) {
  if (!items.length)
    return <p className="px-4 py-6 text-sm text-muted-foreground">Todavía no tenés conversaciones.</p>;
  return (
    <ul className="divide-y">
      {items.map((c) => (
        <li key={c.id}>
          <Link
            href={`/communications/chat?c=${c.id}`}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 hover:bg-surface-muted",
              c.id === activeId && "bg-primary-soft/50",
            )}
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold">
              {c.isGroup ? <Users className="size-4" /> : initials(c.title)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2">
                <span className={cn("truncate text-sm", c.unread > 0 && "font-semibold")}>{c.title}</span>
                {c.unread > 0 && (
                  <span className="rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
                    {c.unread}
                  </span>
                )}
              </span>
              {c.lastMessage && (
                <span className="block truncate text-xs text-muted-foreground">
                  {c.lastMessage.mine ? "Vos: " : c.isGroup ? `${c.lastMessage.author.split(" ")[0]}: ` : ""}
                  {c.lastMessage.body}
                </span>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Hilo con actualización cada 4 segundos (sin websockets: funciona en cualquier hosting). */
export function ChatThread({
  conversationId,
  title,
  members,
  initial,
}: {
  conversationId: string;
  title: string;
  members: string;
  initial: ChatMessageView[];
}) {
  const router = useRouter();
  const [messages, setMessages] = useState(initial);
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  const bottom = useRef<HTMLDivElement>(null);
  const lastAt = messages[messages.length - 1]?.createdAt ?? null;

  useEffect(() => {
    setMessages(initial);
  }, [conversationId, initial]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  useEffect(() => {
    const t = setInterval(async () => {
      const r = await chatMessagesAction(conversationId, lastAt);
      if (r.ok && r.data.length) {
        setMessages((prev) => [...prev, ...r.data.filter((m) => !prev.some((p) => p.id === m.id))]);
        router.refresh(); // actualiza no leídos en la lista
      }
    }, 4000);
    return () => clearInterval(t);
  }, [conversationId, lastAt, router]);

  const send = () => {
    const text = body.trim();
    if (!text) return;
    start(async () => {
      const r = await sendChatMessageAction({ conversationId, body: text });
      if (!r.ok) return void toast.error(r.error);
      setBody("");
      const more = await chatMessagesAction(conversationId, lastAt);
      if (more.ok)
        setMessages((prev) => [...prev, ...more.data.filter((m) => !prev.some((p) => p.id === m.id))]);
      router.refresh();
    });
  };

  return (
    <div className="flex h-[70vh] flex-col">
      <div className="border-b px-4 py-3">
        <p className="text-sm font-semibold">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{members}</p>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <p className="text-center text-sm text-muted-foreground">Escribí el primer mensaje.</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={cn("flex", m.mine ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[75%] rounded-lg px-3 py-2 text-sm",
                m.mine ? "bg-primary text-primary-foreground" : "bg-surface-muted",
              )}
            >
              {!m.mine && <p className="text-xs font-semibold opacity-80">{m.authorName}</p>}
              <p className="whitespace-pre-wrap">{m.body}</p>
              <p
                className={cn(
                  "mt-0.5 text-right text-[10px]",
                  m.mine ? "opacity-80" : "text-muted-foreground",
                )}
              >
                {m.timeLabel}
              </p>
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <form
        className="flex items-end gap-2 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <Textarea
          rows={1}
          className="min-h-9 flex-1 resize-none"
          placeholder="Escribí un mensaje… (Enter envía, Shift+Enter salta de línea)"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <Button type="submit" size="icon" aria-label="Enviar" loading={pending}>
          <Send />
        </Button>
      </form>
    </div>
  );
}
