import type { CatalogItem } from "@crm/core";
import { Bath, BedDouble, Car, MapPin, Ruler } from "lucide-react";
import Link from "next/link";
import { photoUrl } from "@/lib/site";

export function PropertyCard({ item, operation }: { item: CatalogItem; operation?: "sale" | "rent" }) {
  const price = item.prices.find((p) => !operation || p.operation === operation) ?? item.prices[0];
  const area = item.builtArea ?? item.totalArea;
  const facts = [
    item.bedrooms !== null ? { icon: BedDouble, value: item.bedrooms, label: "dormitorios" } : null,
    item.bathrooms !== null ? { icon: Bath, value: item.bathrooms, label: "baños" } : null,
    item.garages ? { icon: Car, value: item.garages, label: "garajes" } : null,
    area ? { icon: Ruler, value: `${area} m²`, label: "superficie" } : null,
  ].filter((f): f is NonNullable<typeof f> => f !== null);
  return (
    <Link
      href={`/propiedades/${item.code}`}
      className="group block overflow-hidden rounded-2xl border border-white/10 bg-[#141414] transition duration-300 hover:-translate-y-1 hover:border-[#d8bf82]/50 hover:shadow-[0_24px_50px_-24px_rgba(216,191,130,0.35)]"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-[#1c1c1c]">
        {item.photoIds[0] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoUrl(item.photoIds[0], "thumb")}
            alt={item.title}
            loading="lazy"
            className="size-full object-cover transition duration-700 group-hover:scale-[1.05]"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-sm text-[#8c867c]">Sin fotos</div>
        )}
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/80 to-transparent" />
        {price && (
          <span className="absolute top-3 left-3 rounded-full bg-black/70 px-3 py-1 text-[11px] font-semibold tracking-[0.15em] text-[#d8bf82] uppercase backdrop-blur">
            {price.operation === "sale" ? "Venta" : "Alquiler"}
          </span>
        )}
        <p className="absolute bottom-3 left-4 text-xl font-bold text-white">
          {price ? (
            <>
              {price.label}
              {price.operation === "rent" && <span className="text-sm font-normal text-white/70"> /mes</span>}
            </>
          ) : (
            "Consultar"
          )}
        </p>
      </div>
      <div className="space-y-2 p-5">
        <h3 className="line-clamp-2 text-base leading-snug font-semibold uppercase">{item.title}</h3>
        {item.zone && (
          <p className="flex items-center gap-1.5 text-sm text-[#a8a29a]">
            <MapPin className="size-3.5 text-[#d8bf82]" /> {item.zone}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/10 pt-3 text-sm text-[#cfc9bf]">
          {facts.map((f) => (
            <span key={f.label} className="flex items-center gap-1.5" title={f.label}>
              <f.icon className="size-4 text-[#d8bf82]" /> {f.value}
            </span>
          ))}
          <span className="ml-auto text-xs tracking-wide text-[#8c867c] uppercase">{item.typeLabel}</span>
        </div>
      </div>
    </Link>
  );
}
