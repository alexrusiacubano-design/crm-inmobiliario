"use client";

import "leaflet/dist/leaflet.css";
import { MapPin, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

function parse(v: string): number | null {
  const n = Number(v.replace(",", ".").trim());
  return v.trim() !== "" && Number.isFinite(n) ? n : null;
}

/**
 * Selector de ubicación con Leaflet y OpenStreetMap: clic en el mapa para marcar el punto
 * (y arrastrar el marcador para ajustarlo). Se carga solo en el navegador y al abrirlo.
 */
export function MapPicker({
  latitude,
  longitude,
  onChange,
}: {
  latitude: string;
  longitude: string;
  onChange: (lat: string, lng: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const lat = parse(latitude);
  const lng = parse(longitude);
  const initial = useRef<[number, number] | null>(lat !== null && lng !== null ? [lat, lng] : null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    void import("leaflet").then((L) => {
      if (cancelled || !ref.current) return;
      const start = initial.current;
      const map = L.map(ref.current).setView(start ?? [-34.9, -56.16], start ? 16 : 12);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);
      const icon = L.divIcon({
        className: "",
        html: '<div style="width:18px;height:18px;border-radius:9999px;background:#2563eb;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });
      let marker: ReturnType<typeof L.marker> | null = null;
      const emit = (ll: { lat: number; lng: number }) =>
        onChangeRef.current(ll.lat.toFixed(6), ll.lng.toFixed(6));
      const place = (ll: { lat: number; lng: number }) => {
        if (!marker) {
          marker = L.marker(ll, { icon, draggable: true }).addTo(map);
          marker.on("dragend", () => marker && emit(marker.getLatLng()));
        } else marker.setLatLng(ll);
      };
      if (start) place({ lat: start[0], lng: start[1] });
      map.on("click", (e: { latlng: { lat: number; lng: number } }) => {
        place(e.latlng);
        emit(e.latlng);
      });
      cleanup = () => map.remove();
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [open]);

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => {
            initial.current = lat !== null && lng !== null ? [lat, lng] : null;
            setOpen(!open);
          }}
        >
          <MapPin />{" "}
          {open ? "Cerrar mapa" : lat !== null && lng !== null ? "Ajustar en el mapa" : "Marcar en el mapa"}
        </Button>
        {lat !== null && lng !== null && (
          <>
            <span className="text-xs text-muted-foreground tabular">
              {lat.toFixed(5)}, {lng.toFixed(5)}
            </span>
            <Button type="button" size="sm" variant="ghost" onClick={() => onChange("", "")}>
              <X /> Quitar
            </Button>
          </>
        )}
      </div>
      {open && (
        <div
          ref={ref}
          className="h-72 w-full overflow-hidden rounded-md border"
          role="application"
          aria-label="Mapa: hacé clic para marcar la ubicación"
        />
      )}
    </div>
  );
}
