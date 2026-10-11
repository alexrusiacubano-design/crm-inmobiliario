"use client";

import { ArrowRight, Calculator, Home, KeyRound, Tag, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

const KEY = "site-welcome-seen";

const OPTIONS = [
  {
    href: "/propiedades?operacion=venta",
    icon: Home,
    title: "Comprar",
    text: "Encontrá tu próxima casa",
    hint: "O una buena inversión",
  },
  {
    href: "/propiedades?operacion=alquiler",
    icon: KeyRound,
    title: "Alquilar",
    text: "Mudate sin complicaciones",
    hint: "Opciones para cada presupuesto",
  },
  {
    href: "/#tasar",
    icon: Calculator,
    title: "Tasar",
    text: "Sabé cuánto vale tu propiedad",
    hint: "Sin costo",
  },
  {
    href: "/#tasar",
    icon: Tag,
    title: "Vender",
    text: "Publicá con nosotros",
    hint: "Te acompañamos hasta la firma",
  },
];

/** Bienvenida «¿Qué te trae hoy?»: aparece una sola vez por visitante. */
export function WelcomeModal({ logoUrl, name }: { logoUrl: string | null; name: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let seen = false;
    try {
      seen = localStorage.getItem(KEY) === "1";
    } catch {
      seen = false;
    }
    if (seen) return;
    const t = setTimeout(() => setOpen(true), 600);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function close() {
    setOpen(false);
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* sin almacenamiento: se volverá a mostrar */
    }
  }

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
      className="fixed inset-0 z-[60] overflow-y-auto bg-black/85 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <div className="relative mx-auto flex min-h-full max-w-3xl flex-col items-center justify-center px-4 py-14">
        <button
          type="button"
          onClick={close}
          aria-label="Cerrar"
          className="absolute top-5 right-5 flex size-11 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white hover:bg-white/10"
        >
          <X className="size-5" />
        </button>
        <div className="flex size-28 items-center justify-center rounded-full border border-[#d8bf82]/60 bg-[radial-gradient(circle,rgba(216,191,130,0.18),transparent_70%)] p-4">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={name} className="size-full rounded-full object-contain" />
          ) : (
            <span className="text-3xl font-bold text-[#d8bf82]">{name.slice(0, 1)}</span>
          )}
        </div>
        <p className="mt-6 text-xs font-semibold tracking-[0.4em] text-[#d8bf82] uppercase">Empecemos</p>
        <h2
          id="welcome-title"
          className="mt-3 text-center text-4xl font-extrabold tracking-tight text-white sm:text-5xl"
        >
          ¿Qué te trae hoy?
        </h2>
        <p className="mt-3 text-center text-[#a8a29a]">
          Contanos qué buscás y te llevamos directo a lo importante.
        </p>
        <div className="mt-10 grid w-full gap-4 sm:grid-cols-2">
          {OPTIONS.map((o) => (
            <Link
              key={o.title}
              href={o.href}
              onClick={close}
              className="group rounded-2xl border border-white/10 bg-[#141414] p-6 transition hover:border-[#d8bf82]/60"
            >
              <span className="flex size-14 items-center justify-center rounded-full border border-[#d8bf82]/60 text-[#d8bf82]">
                <o.icon className="size-6" strokeWidth={1.5} />
              </span>
              <p className="mt-5 text-xl font-bold text-white">{o.title}</p>
              <p className="mt-1 text-[#a8a29a]">{o.text}</p>
              <p className="mt-5 flex items-center justify-between text-xs font-semibold tracking-[0.15em] text-[#d8bf82]/80 uppercase">
                {o.hint}
                <ArrowRight className="size-4 transition group-hover:translate-x-1" />
              </p>
            </Link>
          ))}
        </div>
        <button type="button" onClick={close} className="mt-8 text-sm text-[#8c867c] hover:text-white">
          Ver la página
        </button>
      </div>
    </div>
  );
}
