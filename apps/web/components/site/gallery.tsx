"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

/** Galería de la ficha pública: foto grande, miniaturas y vista a pantalla completa. */
export function Gallery({ photos, title }: { photos: { thumb: string; full: string }[]; title: string }) {
  const [i, setI] = useState(0);
  const [open, setOpen] = useState(false);
  const n = photos.length;
  const go = useCallback((d: number) => setI((x) => (x + d + n) % n), [n]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, go]);

  if (n === 0)
    return (
      <div className="flex aspect-[16/10] items-center justify-center rounded-2xl bg-[#efeae2] text-[#8a847a]">
        Sin fotos
      </div>
    );
  const current = photos[i] ?? photos[0];
  return (
    <div>
      <div className="relative overflow-hidden rounded-2xl bg-[#efeae2]">
        <button
          type="button"
          className="block w-full"
          onClick={() => setOpen(true)}
          aria-label="Ver a pantalla completa"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={current?.full}
            alt={`${title} — foto ${i + 1}`}
            className="aspect-[16/10] w-full object-cover"
          />
        </button>
        {n > 1 && (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="Foto anterior"
              className="absolute top-1/2 left-3 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 shadow hover:bg-white"
            >
              <ChevronLeft className="size-5" />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="Foto siguiente"
              className="absolute top-1/2 right-3 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 shadow hover:bg-white"
            >
              <ChevronRight className="size-5" />
            </button>
            <span className="absolute right-3 bottom-3 rounded-full bg-black/60 px-3 py-1 text-xs text-white">
              {i + 1} / {n}
            </span>
          </>
        )}
      </div>
      {n > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {photos.map((p, idx) => (
            <button
              key={p.thumb}
              type="button"
              onClick={() => setI(idx)}
              aria-label={`Ver foto ${idx + 1}`}
              className={`shrink-0 overflow-hidden rounded-lg border-2 transition ${idx === i ? "border-[#1c1b19]" : "border-transparent opacity-70 hover:opacity-100"}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.thumb} alt="" loading="lazy" className="h-16 w-24 object-cover" />
            </button>
          ))}
        </div>
      )}
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Fotos"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setOpen(false)}
        >
          <button
            type="button"
            aria-label="Cerrar"
            className="absolute top-4 right-4 flex size-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            onClick={() => setOpen(false)}
          >
            <X />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={current?.full}
            alt=""
            className="max-h-full max-w-full object-contain"
            onClick={(e) => {
              e.stopPropagation();
              go(1);
            }}
          />
        </div>
      )}
    </div>
  );
}
