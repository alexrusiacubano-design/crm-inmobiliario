"use client";

import { AlertTriangle } from "lucide-react";
import Link from "next/link";

export interface DuplicateInfo {
  contactId: string | null;
  displayName: string;
  reasons: string[];
  score: number;
}

const REASONS: Record<string, string> = {
  document: "mismo documento",
  phone: "mismo teléfono",
  email: "mismo email",
  name: "nombre parecido",
};

export function DuplicatesNotice({
  duplicates,
  title = "Posibles duplicados",
}: {
  duplicates: DuplicateInfo[];
  title?: string;
}) {
  if (duplicates.length === 0) return null;
  return (
    <div role="status" className="rounded-md border border-warning/40 bg-warning-soft px-4 py-3 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <AlertTriangle className="size-4" aria-hidden /> {title}
      </p>
      <ul className="mt-1.5 grid gap-1">
        {duplicates.map((d, i) => (
          <li key={d.contactId ?? i}>
            {d.contactId ? (
              <Link
                href={`/crm/contacts/${d.contactId}`}
                className="font-medium underline-offset-2 hover:underline"
              >
                {d.displayName}
              </Link>
            ) : (
              <span className="font-medium">{d.displayName}</span>
            )}{" "}
            <span className="text-muted-foreground">
              — {d.reasons.map((r) => REASONS[r] ?? r).join(", ")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
