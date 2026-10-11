"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export function SiteNav({
  items,
  whatsapp,
}: {
  items: { href: string; label: string }[];
  whatsapp: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <nav className="hidden items-center gap-1 text-sm md:flex">
        {items.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className="rounded-full px-3 py-2 text-[var(--site-text2)] transition hover:text-[var(--site-accent)]"
          >
            {n.label}
          </Link>
        ))}
        {whatsapp && (
          <a
            href={whatsapp}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-2 rounded-full bg-gradient-to-r from-[var(--site-accent-from)] to-[var(--site-accent-to)] px-4 py-2 font-semibold text-[var(--site-on-accent)] transition hover:brightness-110"
          >
            WhatsApp
          </a>
        )}
      </nav>
      <button
        type="button"
        aria-label={open ? "Cerrar menú" : "Abrir menú"}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex size-11 items-center justify-center rounded-full bg-[var(--site-hover)] text-[var(--site-accent)] md:hidden"
      >
        {open ? <X className="size-5" /> : <Menu className="size-5" />}
      </button>
      {open && (
        <div className="absolute inset-x-0 top-full border-b border-[var(--site-border)] bg-[var(--site-bg)] px-4 pb-5 md:hidden">
          {items.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              onClick={() => setOpen(false)}
              className="block border-b border-[var(--site-border)] py-3.5 text-base text-[var(--site-text)]"
            >
              {n.label}
            </Link>
          ))}
          {whatsapp && (
            <a
              href={whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 block rounded-xl bg-gradient-to-r from-[var(--site-accent-from)] to-[var(--site-accent-to)] py-3 text-center font-semibold text-[var(--site-on-accent)]"
            >
              Escribinos por WhatsApp
            </a>
          )}
        </div>
      )}
    </>
  );
}
