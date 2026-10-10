"use client";

import { ChevronLeft, ChevronRight, ImageOff, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

const src = (id: string, size: "thumb" | "full") => `/api/media/${id}${size === "thumb" ? "?size=thumb" : ""}`;

/** Galería de la ficha: portada grande, miniaturas y vista a pantalla completa. */
export function PropertyGallery({
  photos,
  title,
  manageHref,
}: {
  photos: { id: string; caption: string | null }[];
  title: string;
  manageHref?: string;
}) {
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
      <div className="flex aspect-[16/9] flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-surface-muted text-muted-foreground">
        <ImageOff className="size-6" aria-hidden />
        <p className="text-sm">Todavía no hay fotos</p>
        {manageHref && (
          <Link href={manageHref} className="text-sm text-primary hover:underline">
            Subir fotos
          </Link>
        )}
      </div>
    );
  const current = photos[i] ?? photos[0];
  return (
    <div className="grid gap-2">
      <div className="relative overflow-hidden rounded-xl bg-surface-muted">
        <button type="button" className="block w-full" onClick={() => setOpen(true)} aria-label="Ver a pantalla completa">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src(current?.id ?? "", "full")} alt={`${title} — foto ${i + 1}`} className="aspect-[16/9] w-full object-cover" />
        </button>
        {i === 0 && (
          <span className="absolute top-3 left-3 rounded-md bg-black/70 px-2 py-0.5 text-xs font-medium text-white">
            Portada
          </span>
        )}
        {n > 1 && (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="Foto anterior"
              className="absolute top-1/2 left-3 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-neutral-900 shadow hover:bg-white"
            >
              <ChevronLeft className="size-5" />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="Foto siguiente"
              className="absolute top-1/2 right-3 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-neutral-900 shadow hover:bg-white"
            >
              <ChevronRight className="size-5" />
            </button>
            <span className="absolute right-3 bottom-3 rounded-full bg-black/60 px-2.5 py-0.5 text-xs text-white">
              {i + 1} / {n}
            </span>
          </>
        )}
      </div>
      {n > 1 && (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {photos.map((p, idx) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setI(idx)}
              aria-label={`Ver foto ${idx + 1}`}
              className={`overflow-hidden rounded-lg border-2 transition ${idx === i ? "border-primary" : "border-transparent opacity-80 hover:opacity-100"}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src(p.id, "thumb")} alt="" loading="lazy" className="aspect-[4/3] w-full object-cover" />
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
            src={src(current?.id ?? "", "full")}
            alt=""
            className="max-h-full max-w-full object-contain"
            onClick={(e) => {
              e.stopPropagation();
              go(1);
            }}
          />
          {current?.caption && (
            <p className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded bg-black/60 px-3 py-1 text-sm text-white">
              {current.caption}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
