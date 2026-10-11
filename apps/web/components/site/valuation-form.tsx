"use client";

import { useState } from "react";

const inputCls =
  "h-12 w-full rounded-xl border border-white/10 bg-[#0a0a0a] px-4 text-sm text-[#f2efe9] outline-none placeholder:text-[#6f6a62] focus:border-[#d8bf82]";

/** «Tasá tu propiedad»: llega al CRM como consulta del canal web, con los datos del inmueble. */
export function ValuationForm({ types }: { types: { value: string; label: string }[] }) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  if (state === "sent")
    return (
      <div className="rounded-2xl border border-[#d8bf82]/40 bg-[#141414] p-8 text-center">
        <p className="text-2xl font-bold text-[#d8bf82]">¡Recibimos tu pedido!</p>
        <p className="mt-2 text-[#a8a29a]">
          Un tasador se va a comunicar con vos en menos de 24 horas hábiles.
        </p>
      </div>
    );

  return (
    <form
      className="grid gap-3 rounded-2xl border border-white/10 bg-[#141414] p-6 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const v = (k: string) => String(fd.get(k) ?? "").trim();
        if (!v("phone") && !v("email")) return setError("Dejanos un teléfono o un email para contactarte.");
        setError(null);
        setState("sending");
        const lines = [
          `Quiero ${v("goal") || "tasar"} mi propiedad.`,
          v("type") && `Tipo: ${v("type")}`,
          v("zone") && `Zona / dirección: ${v("zone")}`,
          v("m2") && `Superficie: ${v("m2")} m²`,
          v("bedrooms") && `Dormitorios: ${v("bedrooms")}`,
          v("notes") && `Comentarios: ${v("notes")}`,
        ].filter(Boolean);
        try {
          const res = await fetch("/api/sitio/consulta", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: v("name"),
              phone: v("phone"),
              email: v("email"),
              message: lines.join("\n"),
              website: v("website"),
            }),
          });
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          if (!res.ok) throw new Error(body.error ?? "No se pudo enviar.");
          setState("sent");
        } catch (err) {
          setError(err instanceof Error ? err.message : "No se pudo enviar.");
          setState("idle");
        }
      }}
    >
      <div className="flex overflow-hidden rounded-xl border border-white/10 sm:col-span-2">
        {[
          ["tasar", "Quiero tasar"],
          ["vender", "Quiero vender"],
          ["alquilar", "Quiero alquilarla"],
        ].map(([val, label], i) => (
          <label key={val} className="flex-1 cursor-pointer">
            <input type="radio" name="goal" value={val} defaultChecked={i === 0} className="peer sr-only" />
            <span className="block py-2.5 text-center text-xs font-medium text-[#a8a29a] peer-checked:bg-[#d8bf82] peer-checked:text-black sm:text-sm">
              {label}
            </span>
          </label>
        ))}
      </div>
      <select name="type" aria-label="Tipo de inmueble" className={inputCls} defaultValue="">
        <option value="">Tipo de inmueble</option>
        {types.map((t) => (
          <option key={t.value} value={t.label}>
            {t.label}
          </option>
        ))}
      </select>
      <input
        name="zone"
        placeholder="Barrio o dirección"
        aria-label="Barrio o dirección"
        className={inputCls}
      />
      <input
        name="m2"
        inputMode="decimal"
        placeholder="M² aproximados"
        aria-label="Metros cuadrados"
        className={inputCls}
      />
      <input
        name="bedrooms"
        inputMode="numeric"
        placeholder="Dormitorios"
        aria-label="Dormitorios"
        className={inputCls}
      />
      <input
        name="name"
        required
        minLength={2}
        placeholder="Tu nombre"
        aria-label="Tu nombre"
        className={`${inputCls} sm:col-span-2`}
      />
      <input
        name="phone"
        type="tel"
        placeholder="Teléfono / WhatsApp"
        aria-label="Teléfono"
        className={inputCls}
      />
      <input name="email" type="email" placeholder="Email" aria-label="Email" className={inputCls} />
      <textarea
        name="notes"
        rows={2}
        placeholder="Comentarios (opcional)"
        aria-label="Comentarios"
        className={`${inputCls} h-auto py-3 sm:col-span-2`}
      />
      <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
      {error && <p className="text-sm text-red-400 sm:col-span-2">{error}</p>}
      <button
        type="submit"
        disabled={state === "sending"}
        className="h-12 rounded-xl bg-gradient-to-r from-[#e3cd96] to-[#b99a5b] font-semibold text-black transition hover:brightness-110 disabled:opacity-60 sm:col-span-2"
      >
        {state === "sending" ? "Enviando…" : "Tasar mi propiedad gratis"}
      </button>
      <p className="text-center text-xs text-[#8c867c] sm:col-span-2">
        Respuesta en menos de 24 hs · Sin compromiso
      </p>
    </form>
  );
}
