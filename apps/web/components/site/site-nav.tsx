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
            className="rounded-full px-3 py-2 text-[#cfc9bf] transition hover:text-[#d8bf82]"
          >
            {n.label}
          </Link>
        ))}
        {whatsapp && (
          <a
            href={whatsapp}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-2 rounded-full bg-gradient-to-r from-[#e3cd96] to-[#b99a5b] px-4 py-2 font-semibold text-black transition hover:brightness-110"
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
        className="flex size-11 items-center justify-center rounded-full bg-white/5 text-[#d8bf82] md:hidden"
      >
        {open ? <X className="size-5" /> : <Menu className="size-5" />}
      </button>
      {open && (
        <div className="absolute inset-x-0 top-full border-b border-white/10 bg-[#0a0a0a] px-4 pb-5 md:hidden">
          {items.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              onClick={() => setOpen(false)}
              className="block border-b border-white/5 py-3.5 text-base text-[#f2efe9]"
            >
              {n.label}
            </Link>
          ))}
          {whatsapp && (
            <a
              href={whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 block rounded-xl bg-gradient-to-r from-[#e3cd96] to-[#b99a5b] py-3 text-center font-semibold text-black"
            >
              Escribinos por WhatsApp
            </a>
          )}
        </div>
      )}
    </>
  );
}
