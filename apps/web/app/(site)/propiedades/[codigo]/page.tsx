import { getCatalogProperty } from "@crm/core";
import { getDb } from "@crm/db";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Gallery } from "@/components/site/gallery";
import { InquiryForm } from "@/components/site/inquiry-form";
import { PropertyCard } from "@/components/site/property-card";
import { getSite, photoUrl, whatsappLink } from "@/lib/site";

async function load(codigo: string) {
  const site = await getSite();
  if (!site) return null;
  const data = await getCatalogProperty(getDb(), site.id, decodeURIComponent(codigo).toUpperCase());
  return data ? { site, ...data } : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ codigo: string }>;
}): Promise<Metadata> {
  const data = await load((await params).codigo);
  if (!data) return { title: "Propiedad no disponible" };
  const { item } = data;
  const price = item.prices[0]?.label;
  return {
    title: item.title,
    description: [item.typeLabel, item.zone, price].filter(Boolean).join(" · "),
    openGraph: {
      title: item.title,
      description: item.description?.slice(0, 180) ?? undefined,
      images: item.photoIds[0] ? [photoUrl(item.photoIds[0])] : undefined,
    },
  };
}

function Fact({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="border-b border-[#ece7df] py-3">
      <dt className="text-xs tracking-[0.15em] text-[#8a847a] uppercase">{label}</dt>
      <dd className="mt-0.5 text-[15px]">{value}</dd>
    </div>
  );
}

export default async function PropertyPage({ params }: { params: Promise<{ codigo: string }> }) {
  const data = await load((await params).codigo);
  if (!data) notFound();
  const { site, item, related } = data;
  const wa = whatsappLink(site.phone, `Hola, me interesa la propiedad ${item.code} (${item.title}).`);
  const loc = item.approxLocation;
  const bbox = loc ? [loc.lng - 0.008, loc.lat - 0.005, loc.lng + 0.008, loc.lat + 0.005].join(",") : null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
      <nav className="mb-6 text-sm text-[#6b665e]">
        <Link href="/propiedades" className="hover:underline">
          Propiedades
        </Link>
        <span className="mx-2">/</span>
        <span>{item.code}</span>
      </nav>

      <div className="grid gap-10 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0">
          <Gallery
            title={item.title}
            photos={item.photoIds.map((id) => ({ thumb: photoUrl(id, "thumb"), full: photoUrl(id) }))}
          />

          <div className="mt-8">
            <p className="text-xs tracking-[0.2em] text-[#8a847a] uppercase">
              {item.typeLabel}
              {item.zone ? ` · ${item.zone}` : ""} · {item.code}
            </p>
            <h1 className="mt-2 font-[family-name:var(--font-serif)] text-4xl leading-tight font-semibold sm:text-5xl">
              {item.title}
            </h1>
            {item.prices[0] && (
              <p className="mt-3 text-2xl font-medium lg:hidden">
                {item.prices[0].label}
                {item.prices[0].operation === "rent" && (
                  <span className="text-base text-[#6b665e]"> /mes</span>
                )}
                <a
                  href="#consulta"
                  className="ml-3 align-middle text-sm font-normal underline underline-offset-4"
                >
                  Consultar
                </a>
              </p>
            )}
            <div className="mt-6 flex flex-wrap gap-x-8 gap-y-3 border-y border-[#e7e2da] py-5 text-sm">
              {item.bedrooms !== null && (
                <span>
                  <b className="text-lg font-medium">{item.bedrooms}</b> dormitorios
                </span>
              )}
              {item.bathrooms !== null && (
                <span>
                  <b className="text-lg font-medium">{item.bathrooms}</b> baños
                </span>
              )}
              {item.garages !== null && item.garages > 0 && (
                <span>
                  <b className="text-lg font-medium">{item.garages}</b> garajes
                </span>
              )}
              {item.builtArea && (
                <span>
                  <b className="text-lg font-medium">{item.builtArea}</b> m² edificados
                </span>
              )}
              {item.totalArea && (
                <span>
                  <b className="text-lg font-medium">{item.totalArea}</b> m² totales
                </span>
              )}
            </div>
          </div>

          {item.description && (
            <section className="mt-8">
              <h2 className="font-[family-name:var(--font-serif)] text-2xl font-semibold">Descripción</h2>
              <p className="mt-3 leading-relaxed whitespace-pre-line text-[#3d3a35]">{item.description}</p>
            </section>
          )}

          <section className="mt-8">
            <h2 className="font-[family-name:var(--font-serif)] text-2xl font-semibold">Detalles</h2>
            <dl className="mt-2 grid gap-x-8 sm:grid-cols-2">
              <Fact label="Tipo" value={item.typeLabel} />
              <Fact label="Zona" value={item.zone} />
              <Fact label="Suites" value={item.suites} />
              <Fact label="Piso" value={item.floor} />
              <Fact label="Año de construcción" value={item.yearBuilt} />
              <Fact label="Orientación" value={item.orientation} />
              <Fact label="Estado" value={item.condition} />
              <Fact label="Amueblada" value={item.furnished ? "Sí" : null} />
              <Fact label="Acepta mascotas" value={item.petsAllowed ? "Sí" : null} />
            </dl>
          </section>

          {item.features.length > 0 && (
            <section className="mt-8">
              <h2 className="font-[family-name:var(--font-serif)] text-2xl font-semibold">Comodidades</h2>
              <ul className="mt-3 flex flex-wrap gap-2">
                {item.features.map((x) => (
                  <li key={x} className="rounded-full border border-[#ddd6cb] bg-white px-3 py-1.5 text-sm">
                    {x}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {loc && bbox && (
            <section className="mt-8">
              <h2 className="font-[family-name:var(--font-serif)] text-2xl font-semibold">
                Ubicación aproximada
              </h2>
              <p className="mt-1 text-sm text-[#6b665e]">
                La dirección exacta se informa al coordinar la visita.
              </p>
              <iframe
                title="Mapa"
                loading="lazy"
                className="mt-3 h-72 w-full rounded-2xl border border-[#e7e2da]"
                src={`https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${loc.lat},${loc.lng}`}
              />
            </section>
          )}
        </div>

        <aside id="consulta" className="scroll-mt-24 lg:sticky lg:top-28 lg:self-start">
          <div className="rounded-2xl border border-[#e7e2da] bg-white p-6 shadow-sm">
            {item.prices.length > 0 ? (
              item.prices.map((p) => (
                <div key={p.operation} className="mb-2">
                  <p className="text-xs tracking-[0.2em] text-[#8a847a] uppercase">
                    {p.operation === "sale" ? "Venta" : "Alquiler"}
                  </p>
                  <p className="font-[family-name:var(--font-serif)] text-4xl font-semibold">
                    {p.label}
                    {p.operation === "rent" && (
                      <span className="font-sans text-base font-normal text-[#6b665e]"> /mes</span>
                    )}
                  </p>
                </div>
              ))
            ) : (
              <p className="font-[family-name:var(--font-serif)] text-3xl font-semibold">Consultar precio</p>
            )}
            <hr className="my-5 border-[#ece7df]" />
            <p className="mb-3 font-medium">¿Te interesa esta propiedad?</p>
            <InquiryForm
              propertyCode={item.code}
              defaultMessage={`Hola, me interesa ${item.title} (${item.code}). Quisiera más información.`}
            />
            {wa && (
              <a
                href={wa}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 flex h-11 items-center justify-center rounded-lg border border-[#1c1b19] text-sm font-medium transition hover:bg-[#1c1b19] hover:text-white"
              >
                Consultar por WhatsApp
              </a>
            )}
          </div>
        </aside>
      </div>

      {related.length > 0 && (
        <section className="mt-16">
          <h2 className="mb-6 font-[family-name:var(--font-serif)] text-3xl font-semibold">
            También te puede interesar
          </h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((r) => (
              <PropertyCard key={r.code} item={r} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
