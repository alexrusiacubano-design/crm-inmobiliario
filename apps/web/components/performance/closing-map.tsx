"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface MapPoint {
  id: string;
  kind: "sold" | "rented" | "reserved";
  propertyId: string;
  label: string;
  lat: number;
  lng: number;
  date: string;
  priceText: string;
}

export interface MinePoint {
  propertyId: string;
  label: string;
  lat: number;
  lng: number;
}

/** Colores de estado (con leyenda y texto; nunca solo color). */
const KIND = {
  sold: { label: "Vendida", color: "#15803d" },
  rented: { label: "Alquilada", color: "#2563eb" },
  reserved: { label: "Reservada", color: "#d97706" },
} as const;

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

/**
 * Mapa de cierres con Leaflet y OpenStreetMap. Se carga solo en el navegador. Los filtros
 * de tipo (vendida / alquilada / reservada / mis activas) se aplican sin recargar.
 */
export function ClosingMap({
  points,
  mine,
  counts,
}: {
  points: MapPoint[];
  mine: MinePoint[];
  counts: Record<keyof typeof KIND, number>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState<Record<string, boolean>>({
    sold: true,
    rented: true,
    reserved: true,
    mine: false,
  });

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    void import("leaflet").then((L) => {
      if (cancelled || !ref.current) return;
      const map = L.map(ref.current, { scrollWheelZoom: true }).setView([-32.8, -56.0], 6);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);
      const layer = L.layerGroup().addTo(map);
      const bounds: [number, number][] = [];
      for (const p of points) {
        if (!visible[p.kind]) continue;
        const k = KIND[p.kind];
        L.circleMarker([p.lat, p.lng], {
          radius: 7,
          color: "#ffffff",
          weight: 2,
          fillColor: k.color,
          fillOpacity: 0.95,
        })
          .bindPopup(
            `<strong>${escapeHtml(k.label)}</strong><br>${escapeHtml(p.label)}<br>${escapeHtml(p.priceText)} · ${escapeHtml(
              p.date.split("-").reverse().join("/"),
            )}<br><a href="/properties/${encodeURIComponent(p.propertyId)}">Ver propiedad</a>`,
          )
          .addTo(layer);
        bounds.push([p.lat, p.lng]);
      }
      if (visible.mine)
        for (const m of mine) {
          L.circleMarker([m.lat, m.lng], { radius: 6, color: "#7c3aed", weight: 2, fillOpacity: 0 })
            .bindPopup(`<strong>Mi propiedad activa</strong><br>${escapeHtml(m.label)}`)
            .addTo(layer);
          bounds.push([m.lat, m.lng]);
        }
      if (bounds.length) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
      cleanup = () => map.remove();
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [points, mine, visible]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        {(Object.keys(KIND) as (keyof typeof KIND)[]).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={visible[k]}
            onClick={() => setVisible({ ...visible, [k]: !visible[k] })}
            className={cn(
              "flex items-center gap-2 rounded-full border px-3 py-1",
              !visible[k] && "opacity-50",
            )}
          >
            <span className="size-2.5 rounded-full" style={{ background: KIND[k].color }} aria-hidden />
            {KIND[k].label}
            <span className="text-xs text-muted-foreground tabular">{counts[k]}</span>
          </button>
        ))}
        <button
          type="button"
          aria-pressed={visible.mine}
          onClick={() => setVisible({ ...visible, mine: !visible.mine })}
          className={cn(
            "ml-auto flex items-center gap-2 rounded-full border px-3 py-1",
            !visible.mine && "opacity-60",
          )}
        >
          <span className="size-2.5 rounded-full border-2 border-[#7c3aed]" aria-hidden /> Mis activas
          <span className="text-xs text-muted-foreground tabular">{mine.length}</span>
        </button>
      </div>
      <div
        ref={ref}
        className="h-[60vh] min-h-80 w-full overflow-hidden rounded-xl border"
        role="region"
        aria-label="Mapa de cierres"
      />
    </div>
  );
}
