"use client";

import { useState } from "react";

const inputCls =
  "h-11 w-full rounded-lg border border-white/10 bg-[#141414] px-3 text-sm text-[#f2efe9] outline-none placeholder:text-[#6f6a62] focus:border-[#d8bf82]";

/** «Me interesa»: los datos llegan al CRM como consulta del canal web. */
export function InquiryForm({
  propertyCode,
  defaultMessage,
}: {
  propertyCode?: string;
  defaultMessage?: string;
}) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  if (state === "sent")
    return (
      <div className="rounded-xl bg-[#1c1c1c] p-5 text-center">
        <p className="font-bold tracking-tight text-xl font-semibold">¡Gracias por tu consulta!</p>
        <p className="mt-1 text-sm text-[#a8a29a]">Un asesor se va a comunicar con vos a la brevedad.</p>
      </div>
    );

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const data = Object.fromEntries(fd.entries());
        if (!data.phone && !data.email) return setError("Dejanos un teléfono o un email para responderte.");
        setError(null);
        setState("sending");
        try {
          const res = await fetch("/api/sitio/consulta", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...data, propertyCode: propertyCode ?? "" }),
          });
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          if (!res.ok) {
            setError(body.error ?? "No se pudo enviar. Probá de nuevo.");
            setState("idle");
          } else setState("sent");
        } catch {
          setError("Sin conexión. Probá de nuevo.");
          setState("idle");
        }
      }}
    >
      <input
        name="name"
        required
        minLength={2}
        placeholder="Nombre y apellido"
        className={inputCls}
        autoComplete="name"
      />
      <input name="phone" placeholder="Teléfono" inputMode="tel" className={inputCls} autoComplete="tel" />
      <input name="email" type="email" placeholder="Email" className={inputCls} autoComplete="email" />
      <textarea
        name="message"
        rows={3}
        defaultValue={defaultMessage}
        className={`${inputCls} h-auto py-2.5`}
        placeholder="Tu consulta"
      />
      {/* Campo trampa para bots: oculto para las personas. */}
      <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
      {error && <p className="text-sm text-red-700">{error}</p>}
      <button
        type="submit"
        disabled={state === "sending"}
        className="h-11 w-full rounded-lg bg-gradient-to-r from-[#e3cd96] to-[#b99a5b] text-sm font-medium tracking-wide text-black transition hover:brightness-110 disabled:opacity-60"
      >
        {state === "sending" ? "Enviando…" : "Quiero que me contacten"}
      </button>
      <p className="text-center text-[11px] text-[#8c867c]">
        Usamos tus datos solo para responder tu consulta.
      </p>
    </form>
  );
}
