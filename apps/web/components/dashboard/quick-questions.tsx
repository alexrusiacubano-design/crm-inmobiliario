"use client";

import { ChevronRight, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/utils";

export interface QuickAnswer {
  question: string;
  intro: string;
  lines: { text: string; href: string; tone?: "warning" | "danger" }[];
  empty: string;
}

/** Preguntas rápidas sobre tu día, respondidas con los datos del CRM. */
export function QuickQuestions({ firstName, answers }: { firstName: string; answers: QuickAnswer[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const a = open !== null ? answers[open] : null;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <span className="flex size-7 items-center justify-center rounded-full bg-primary-soft text-primary">
          <Sparkles className="size-4" />
        </span>
        <p className="text-sm font-semibold">Tu asistente</p>
      </div>
      <div className="flex-1 space-y-3 p-4">
        <p className="w-fit max-w-full rounded-xl rounded-tl-sm bg-surface-muted px-3 py-2 text-sm">
          Hola, {firstName}. {a ? a.intro : "¿En qué te ayudo hoy?"}
        </p>
        {a && (
          <div className="rounded-xl border bg-surface p-1">
            {a.lines.length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted-foreground">{a.empty}</p>
            ) : (
              <ul>
                {a.lines.map((l) => (
                  <li key={l.text}>
                    <Link
                      href={l.href}
                      className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm hover:bg-surface-muted"
                    >
                      <span
                        className={cn(
                          "min-w-0",
                          l.tone === "danger" && "text-danger",
                          l.tone === "warning" &&
                            "text-[color-mix(in_oklch,var(--warning)_75%,var(--foreground))]",
                        )}
                      >
                        {l.text}
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      <div className="grid gap-1.5 border-t p-3">
        {answers.map((q, i) => (
          <button
            key={q.question}
            type="button"
            onClick={() => setOpen(open === i ? null : i)}
            className={cn(
              "flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:border-border-strong",
              open === i ? "border-primary/60 bg-primary-soft text-foreground" : "text-muted-foreground",
            )}
          >
            {q.question}
            <ChevronRight className={cn("size-4 transition-transform", open === i && "rotate-90")} />
          </button>
        ))}
      </div>
    </div>
  );
}
