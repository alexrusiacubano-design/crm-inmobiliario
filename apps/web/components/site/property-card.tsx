import type { CatalogItem } from "@crm/core";
import Link from "next/link";
import { photoUrl } from "@/lib/site";

export function PropertyCard({ item, operation }: { item: CatalogItem; operation?: "sale" | "rent" }) {
  const price = item.prices.find((p) => !operation || p.operation === operation) ?? item.prices[0];
  const facts = [
    item.bedrooms !== null ? `${item.bedrooms} dorm.` : null,
    item.bathrooms !== null ? `${item.bathrooms} baños` : null,
    item.builtArea ? `${item.builtArea} m²` : null,
  ].filter(Boolean);
  return (
    <Link
      href={`/propiedades/${item.code}`}
      className="group block overflow-hidden rounded-xl border border-[#e7e2da] bg-white transition hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-20px_rgba(28,27,25,0.35)]"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-[#efeae2]">
        {item.photoIds[0] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoUrl(item.photoIds[0], "thumb")}
            alt={item.title}
            loading="lazy"
            className="size-full object-cover transition duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-sm text-[#8a847a]">Sin fotos</div>
        )}
        {price && (
          <span className="absolute top-3 left-3 rounded-full bg-white/95 px-3 py-1 text-[11px] font-medium tracking-[0.15em] uppercase">
            {price.operation === "sale" ? "Venta" : "Alquiler"}
          </span>
        )}
      </div>
      <div className="space-y-1.5 p-5">
        <p className="text-xs tracking-[0.15em] text-[#8a847a] uppercase">
          {item.typeLabel}
          {item.zone ? ` · ${item.zone}` : ""}
        </p>
        <h3 className="line-clamp-2 font-[family-name:var(--font-serif)] text-xl leading-snug font-semibold">
          {item.title}
        </h3>
        {facts.length > 0 && <p className="text-sm text-[#6b665e]">{facts.join(" · ")}</p>}
        <p className="pt-2 text-lg font-medium">
          {price ? (
            <>
              {price.label}
              {price.operation === "rent" && <span className="text-sm text-[#6b665e]"> /mes</span>}
            </>
          ) : (
            "Consultar precio"
          )}
        </p>
      </div>
    </Link>
  );
}
