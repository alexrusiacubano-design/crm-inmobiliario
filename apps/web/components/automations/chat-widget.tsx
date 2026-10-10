"use client";

import { Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { cn } from "@/lib/utils";

interface Card {
  code: string;
  title: string;
  zone: string;
  price: string;
  facts: string;
  photoId: string | null;
}
type Quick = { label: string; action?: unknown; contact?: true; propertyCode?: string | null };
interface Reply {
  messages: string[];
  cards?: Card[];
  quick?: Quick[];
  done?: boolean;
}
type Entry = { from: "bot" | "me"; text?: string; cards?: Card[] };

/** Chat público del asistente virtual (se usa dentro de un iframe en el sitio web). */
export function ChatWidget({
  token,
  orgName,
  logoUrl = null,
}: {
  token: string;
  orgName: string;
  logoUrl?: string | null;
}) {
  const [log, setLog] = useState<Entry[]>([]);
  const [quick, setQuick] = useState<Quick[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ propertyCode: string | null } | null>(null);
  const [contact, setContact] = useState({ name: "", phone: "", email: "", message: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const send = async (action: Record<string, unknown>, echo?: string) => {
    if (echo) setLog((l) => [...l, { from: "me", text: echo }]);
    setBusy(true);
    setQuick([]);
    try {
      const res = await fetch(`/api/bot/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      });
      const data = (await res.json()) as Reply & { error?: string };
      if (!res.ok) {
        setLog((l) => [...l, { from: "bot", text: data.error ?? "No pude responder. Probá de nuevo." }]);
        return data;
      }
      setLog((l) => [
        ...l,
        ...data.messages.map((m) => ({ from: "bot" as const, text: m })),
        ...(data.cards?.length ? [{ from: "bot" as const, cards: data.cards }] : []),
      ]);
      setQuick(data.quick ?? []);
      if (data.done) setDone(true);
      return data;
    } catch {
      setLog((l) => [...l, { from: "bot", text: "Sin conexión. Probá de nuevo." }]);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void send({ type: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [log, form]);

  const transcript = () =>
    log
      .filter((e) => e.text)
      .map((e) => `${e.from === "me" ? "Cliente" : "Asistente"}: ${e.text}`)
      .join("\n")
      .slice(-3500);

  return (
    <div className="flex h-dvh flex-col bg-surface">
      <header className="flex items-center gap-3 bg-primary px-4 py-3 text-primary-foreground">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className="size-9 rounded-full bg-neutral-950 object-contain p-0.5" />
        ) : (
          <div className="flex size-9 items-center justify-center rounded-full bg-white/20 text-sm font-semibold">
            {orgName.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{orgName}</p>
          <p className="text-xs opacity-80">Asistente virtual</p>
        </div>
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto p-3" aria-live="polite">
        {log.map((e, i) =>
          e.cards ? (
            <div key={i} className="grid gap-2">
              {e.cards.map((c) => (
                <div key={c.code} className="flex gap-3 overflow-hidden rounded-lg border bg-surface p-2">
                  {c.photoId ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/bot/${token}/media/${c.photoId}`}
                      alt=""
                      className="size-20 shrink-0 rounded object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="size-20 shrink-0 rounded bg-surface-muted" />
                  )}
                  <div className="min-w-0 text-xs">
                    <p className="line-clamp-2 text-sm font-medium">{c.title}</p>
                    <p className="text-muted-foreground">{c.zone}</p>
                    <p className="text-muted-foreground">{c.facts}</p>
                    <p className="mt-0.5 font-semibold">{c.price}</p>
                    <button
                      type="button"
                      className="mt-1 text-primary hover:underline"
                      onClick={() => setForm({ propertyCode: c.code })}
                    >
                      Consultar ({c.code})
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div key={i} className={cn("flex", e.from === "me" ? "justify-end" : "justify-start")}>
              <p
                className={cn(
                  "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm",
                  e.from === "me"
                    ? "rounded-br-sm bg-primary text-primary-foreground"
                    : "rounded-bl-sm bg-surface-muted",
                )}
              >
                {e.text}
              </p>
            </div>
          ),
        )}
        {busy && <p className="text-xs text-muted-foreground">Escribiendo…</p>}
        {!done && !form && quick.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {quick.map((q, i) => (
              <button
                key={i}
                type="button"
                className="rounded-full border border-primary/40 px-3 py-1 text-xs text-primary hover:bg-primary-soft"
                onClick={() =>
                  q.contact
                    ? setForm({ propertyCode: q.propertyCode ?? null })
                    : void send(q.action as Record<string, unknown>, q.label)
                }
              >
                {q.label}
              </button>
            ))}
          </div>
        )}
        {form && !done && (
          <form
            className="grid gap-2 rounded-lg border p-3"
            noValidate
            onSubmit={async (e) => {
              e.preventDefault();
              setFormError(null);
              const r = await send({
                type: "handoff",
                ...contact,
                propertyCode: form.propertyCode,
                transcript: transcript(),
              });
              if (r && "error" in r && r.error) setFormError(r.error);
              else setForm(null);
            }}
          >
            <p className="text-sm font-medium">
              Dejanos tus datos{form.propertyCode ? ` (${form.propertyCode})` : ""}
            </p>
            <Input
              placeholder="Nombre"
              aria-label="Nombre"
              value={contact.name}
              onChange={(e) => setContact({ ...contact, name: e.target.value })}
            />
            <Input
              placeholder="Teléfono / WhatsApp"
              aria-label="Teléfono"
              inputMode="tel"
              value={contact.phone}
              onChange={(e) => setContact({ ...contact, phone: e.target.value })}
            />
            <Input
              placeholder="Email (opcional)"
              aria-label="Email"
              type="email"
              value={contact.email}
              onChange={(e) => setContact({ ...contact, email: e.target.value })}
            />
            <Input
              placeholder="¿Qué necesitás? (opcional)"
              aria-label="Mensaje"
              value={contact.message}
              onChange={(e) => setContact({ ...contact, message: e.target.value })}
            />
            {formError && <p className="text-xs text-danger">{formError}</p>}
            <div className="flex gap-2">
              <Button type="submit" size="sm" loading={busy}>
                Enviar
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setForm(null)}>
                Volver
              </Button>
            </div>
          </form>
        )}
        <div ref={endRef} />
      </div>
      {!done && (
        <form
          className="flex gap-2 border-t p-2"
          onSubmit={(e) => {
            e.preventDefault();
            const t = text.trim();
            if (!t || busy) return;
            setText("");
            void send({ type: "message", text: t }, t);
          }}
        >
          <Input
            aria-label="Escribí tu mensaje"
            placeholder="Escribí tu pregunta o un código (PROP-12)…"
            value={text}
            maxLength={500}
            onChange={(e) => setText(e.target.value)}
          />
          <Button type="submit" size="icon" aria-label="Enviar" disabled={busy || !text.trim()}>
            <Send />
          </Button>
        </form>
      )}
    </div>
  );
}
