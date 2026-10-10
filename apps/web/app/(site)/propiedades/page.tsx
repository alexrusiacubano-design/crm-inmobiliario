import { listCatalog } from "@crm/core";
import { getDb } from "@crm/db";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PropertyCard } from "@/components/site/property-card";
import { getSite } from "@/lib/site";

export const metadata: Metadata = { title: "Propiedades" };

const fieldBase =
  "h-11 rounded-lg border border-[#ddd6cb] bg-white px-3 text-sm text-[#1c1b19] outline-none focus:border-[#1c1b19]";
const selectCls = `${fieldBase} w-full`;

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const site = await getSite();
  if (!site) notFound();
  const raw = Object.fromEntries(
    Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v || undefined]),
  );
  const { items, total, filters: f, options } = await listCatalog(getDb(), site.id, raw);
  const op = f.operacion === "venta" ? "sale" : f.operacion === "alquiler" ? "rent" : undefined;
  const heading =
    op === "sale"
      ? "Propiedades en venta"
      : op === "rent"
        ? "Propiedades en alquiler"
        : "Todas nuestras propiedades";
  const filtered = Object.values(f).some((v) => v !== undefined);

  return (
    <>
      <section className="border-b border-[#e7e2da] bg-gradient-to-b from-white to-[#faf8f5]">
        <div className="mx-auto max-w-7xl px-4 pt-14 pb-10 sm:px-6 sm:pt-20">
          <p className="text-xs font-medium tracking-[0.3em] text-[#8a847a] uppercase">{site.name}</p>
          <h1 className="mt-3 max-w-3xl font-[family-name:var(--font-serif)] text-4xl leading-tight font-semibold sm:text-6xl">
            Encontrá el lugar <em className="font-medium">donde querés vivir</em>
          </h1>
          <p className="mt-4 max-w-xl text-[#6b665e]">
            Una selección cuidada de casas, apartamentos y terrenos en venta y alquiler.
          </p>

          <form
            method="get"
            className="mt-10 grid gap-3 rounded-2xl border border-[#e7e2da] bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_1.5fr_auto]"
          >
            <select
              name="operacion"
              defaultValue={f.operacion ?? ""}
              className={selectCls}
              aria-label="Operación"
            >
              <option value="">Venta y alquiler</option>
              <option value="venta">Venta</option>
              <option value="alquiler">Alquiler</option>
            </select>
            <select name="tipo" defaultValue={f.tipo ?? ""} className={selectCls} aria-label="Tipo">
              <option value="">Todos los tipos</option>
              {options.types.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <select name="zona" defaultValue={f.zona ?? ""} className={selectCls} aria-label="Zona">
              <option value="">Todas las zonas</option>
              {options.zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
            <select
              name="dormitorios"
              defaultValue={f.dormitorios?.toString() ?? ""}
              className={selectCls}
              aria-label="Dormitorios"
            >
              <option value="">Dormitorios</option>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}+ dormitorios
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <input
                name="precioMax"
                inputMode="numeric"
                placeholder="Precio máx."
                defaultValue={f.precioMax?.toString() ?? ""}
                className={`${fieldBase} w-0 min-w-0 flex-1`}
                aria-label="Precio máximo"
              />
              <select
                name="moneda"
                defaultValue={f.moneda ?? ""}
                className={`${fieldBase} w-20 shrink-0`}
                aria-label="Moneda"
              >
                <option value="">Auto</option>
                <option value="USD">U$S</option>
                <option value="UYU">$</option>
              </select>
            </div>
            <button
              type="submit"
              className="h-11 rounded-lg bg-[#1c1b19] px-5 text-sm font-medium tracking-wide text-white transition hover:bg-black"
            >
              Buscar
            </button>
          </form>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-[family-name:var(--font-serif)] text-3xl font-semibold">{heading}</h2>
            <p className="mt-1 text-sm text-[#6b665e]">
              {items.length} {items.length === 1 ? "propiedad" : "propiedades"}
              {filtered && total !== items.length ? ` de ${total}` : ""}
              {filtered && (
                <>
                  {" · "}
                  <Link href="/propiedades" className="underline underline-offset-4">
                    Quitar filtros
                  </Link>
                </>
              )}
            </p>
          </div>
          <form method="get" className="flex items-center gap-2 text-sm">
            {Object.entries(f)
              .filter(([k, v]) => k !== "orden" && v !== undefined)
              .map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={String(v)} />
              ))}
            <label htmlFor="orden" className="text-[#6b665e]">
              Ordenar
            </label>
            <select
              id="orden"
              name="orden"
              defaultValue={f.orden ?? "recientes"}
              className={`${fieldBase} h-9 w-44`}
            >
              <option value="recientes">Más recientes</option>
              <option value="precio-asc">Menor precio</option>
              <option value="precio-desc">Mayor precio</option>
            </select>
            <button
              type="submit"
              className="h-9 rounded-lg border border-[#ddd6cb] bg-white px-3 hover:border-[#1c1b19]"
            >
              Aplicar
            </button>
          </form>
        </div>

        {items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#ddd6cb] bg-white px-6 py-16 text-center">
            <p className="font-[family-name:var(--font-serif)] text-2xl font-semibold">
              {total === 0
                ? "Muy pronto vas a ver nuestras propiedades acá"
                : "No encontramos propiedades con esos filtros"}
            </p>
            <p className="mx-auto mt-2 max-w-md text-sm text-[#6b665e]">
              {total === 0
                ? "Estamos preparando el catálogo. Mientras tanto, escribinos y te contamos qué tenemos disponible."
                : "Probá con menos filtros o dejanos tu consulta y te avisamos cuando entre algo así."}
            </p>
            <a
              href="#contacto"
              className="mt-6 inline-block rounded-full bg-[#1c1b19] px-5 py-2.5 text-sm text-white hover:bg-black"
            >
              Contactanos
            </a>
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((i) => (
              <PropertyCard key={i.code} item={i} operation={op} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
