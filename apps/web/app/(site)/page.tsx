import { listCatalog, siteHighlights } from "@crm/core";
import { getDb } from "@crm/db";
import { PROPERTY_TYPE_LABELS, PROPERTY_TYPES } from "@crm/shared/crm";
import { ArrowRight, BadgeCheck, Calculator, Handshake, MessageCircle, Search, Sparkles } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PropertyCard } from "@/components/site/property-card";
import { ValuationForm } from "@/components/site/valuation-form";
import { WelcomeModal } from "@/components/site/welcome-modal";
import { getSessionContext } from "@/lib/session";
import { getSite, photoUrl, whatsappLink } from "@/lib/site";

const selectCls =
  "h-12 w-full appearance-none rounded-xl border border-white/10 bg-[#0a0a0a]/80 px-4 text-sm text-[#f2efe9] outline-none focus:border-[#d8bf82]";

const FEATURES = [
  {
    icon: Handshake,
    title: "Acompañamiento real",
    text: "Un asesor te guía desde la primera visita hasta la firma, y sigue disponible después.",
  },
  {
    icon: BadgeCheck,
    title: "Propiedades verificadas",
    text: "Cada inmueble se revisa antes de publicarse: datos claros, fotos reales y precio coherente.",
  },
  {
    icon: Sparkles,
    title: "Tecnología a tu favor",
    text: "Datos de mercado, difusión en los principales portales y respuestas rápidas por WhatsApp.",
  },
  {
    icon: Calculator,
    title: "Tasación sin costo",
    text: "Un tasador analiza comparables de la zona y te da un rango de valor fundamentado.",
  },
];

/** Portada pública. Con sesión iniciada, va directo al CRM. */
export default async function Home() {
  const session = await getSessionContext().catch(() => null);
  if (session) redirect("/dashboard");
  const site = await getSite();
  if (!site) redirect("/login");
  const db = getDb();
  const [catalog, highlights] = await Promise.all([
    listCatalog(db, site.id, {}),
    siteHighlights(db, site.id).catch(() => ({ closedDeals: 0, offices: [] })),
  ]);
  const featured = catalog.items.slice(0, 6);
  const heroPhoto = catalog.items.find((i) => i.photoIds.length)?.photoIds[0];
  const wa = whatsappLink(site.phone, `Hola ${site.name}, quisiera hacer una consulta.`);
  const stats = [
    { value: catalog.total, label: "Propiedades activas" },
    { value: highlights.closedDeals, label: "Operaciones cerradas" },
    { value: highlights.offices.length, label: highlights.offices.length === 1 ? "Oficina" : "Oficinas" },
  ].filter((s) => s.value > 0);
  const types = PROPERTY_TYPES.map((t) => ({ value: t, label: PROPERTY_TYPE_LABELS[t] }));

  return (
    <>
      <WelcomeModal logoUrl={site.logoUrl} name={site.name} />

      {/* ── Hero ───────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        {heroPhoto && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoUrl(heroPhoto)}
            alt=""
            className="absolute inset-0 size-full object-cover opacity-30 grayscale-[40%]"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-[#0a0a0a]/60 via-[#0a0a0a]/80 to-[#0a0a0a]" />
        <div className="absolute -top-40 left-1/2 h-[480px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(216,191,130,0.16),transparent)]" />
        <div className="relative mx-auto max-w-7xl px-4 pt-16 pb-14 sm:px-6 sm:pt-28 sm:pb-20">
          <h1 className="max-w-4xl text-4xl leading-[1.05] font-extrabold tracking-tight sm:text-6xl lg:text-7xl">
            Encontrá la propiedad{" "}
            <span className="bg-gradient-to-r from-[#ecd9a6] to-[#c3a465] bg-clip-text text-transparent">
              que estás buscando
            </span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-[#a8a29a]">
            Casas, apartamentos, oficinas y terrenos seleccionados uno por uno. Con un equipo que te asesora
            en cada paso, hasta la firma.
          </p>

          <form
            action="/propiedades"
            method="get"
            className="mt-10 grid max-w-4xl gap-3 rounded-2xl border border-white/10 bg-black/50 p-4 backdrop-blur-md sm:grid-cols-2 sm:p-5 lg:grid-cols-[1.4fr_1fr_1fr_auto]"
          >
            <label className="relative sm:col-span-2 lg:col-span-1">
              <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-[#d8bf82]" />
              <select name="zona" defaultValue="" aria-label="Zona o barrio" className={`${selectCls} pl-11`}>
                <option value="">Zona o barrio</option>
                {catalog.options.zones.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </label>
            <select name="operacion" defaultValue="" aria-label="Operación" className={selectCls}>
              <option value="">Operación</option>
              <option value="venta">Comprar</option>
              <option value="alquiler">Alquilar</option>
            </select>
            <select name="tipo" defaultValue="" aria-label="Tipo" className={selectCls}>
              <option value="">Tipo</option>
              {catalog.options.types.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="h-12 rounded-xl bg-gradient-to-r from-[#e3cd96] to-[#b99a5b] px-8 font-semibold text-black transition hover:brightness-110 sm:col-span-2 lg:col-span-1"
            >
              Buscar
            </button>
          </form>

          {stats.length > 0 && (
            <dl className="mt-12 flex flex-wrap gap-x-12 gap-y-6">
              {stats.map((s) => (
                <div key={s.label}>
                  <dt className="sr-only">{s.label}</dt>
                  <dd className="text-4xl font-extrabold text-[#d8bf82] tabular-nums">
                    {s.value.toLocaleString("es-UY")}
                    {s.value >= 10 ? "+" : ""}
                  </dd>
                  <p className="mt-1 text-sm text-[#a8a29a]">{s.label}</p>
                </div>
              ))}
            </dl>
          )}
        </div>
      </section>

      {/* ── Destacadas ─────────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.3em] text-[#d8bf82] uppercase">Selección</p>
            <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">
              Propiedades destacadas
            </h2>
          </div>
          <Link
            href="/propiedades"
            className="flex shrink-0 items-center gap-1.5 text-sm font-medium text-[#d8bf82] hover:underline"
          >
            Ver todas <ArrowRight className="size-4" />
          </Link>
        </div>
        {featured.length ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((item) => (
              <PropertyCard key={item.code} item={item} />
            ))}
          </div>
        ) : (
          <p className="rounded-2xl border border-white/10 bg-[#141414] p-10 text-center text-[#a8a29a]">
            Muy pronto vas a ver nuestras propiedades acá.
          </p>
        )}
      </section>

      {/* ── Tasación ───────────────────────────────────────────── */}
      <section id="tasar" className="scroll-mt-20 border-y border-white/10 bg-[#0e0e0e]">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[1fr_1.1fr] lg:items-center">
          <div>
            <p className="text-xs font-semibold tracking-[0.3em] text-[#d8bf82] uppercase">
              Tasación gratuita
            </p>
            <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-5xl">
              ¿Cuánto vale tu propiedad?
            </h2>
            <p className="mt-4 max-w-lg text-[#a8a29a]">
              Completá el formulario en un minuto. Un tasador profesional analiza los datos y comparables de
              la zona y te contacta con un rango de valor fundamentado.
            </p>
            <ol className="mt-8 grid gap-4 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              {[
                ["1 minuto", "Completás el formulario"],
                ["Análisis", "Comparamos con el mercado"],
                ["Contacto", "Te llamamos con el valor"],
              ].map(([t, d], i) => (
                <li key={t} className="flex items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-[#d8bf82]/60 text-sm font-bold text-[#d8bf82]">
                    {i + 1}
                  </span>
                  <span>
                    <span className="block font-semibold">{t}</span>
                    <span className="text-sm text-[#a8a29a]">{d}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <ValuationForm types={types} />
        </div>
      </section>

      {/* ── Diferenciales ──────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20">
        <h2 className="max-w-2xl text-3xl font-extrabold tracking-tight sm:text-4xl">
          Una forma distinta de hacer inmobiliaria
        </h2>
        <div className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div key={f.title}>
              <f.icon className="size-7 text-[#d8bf82]" strokeWidth={1.5} />
              <h3 className="mt-4 text-lg font-bold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[#a8a29a]">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Contacto ───────────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6">
        <div className="relative overflow-hidden rounded-3xl border border-[#d8bf82]/25 bg-gradient-to-br from-[#1a1712] to-[#0e0e0e] p-8 sm:p-14">
          <div className="absolute -right-24 -bottom-24 size-80 rounded-full bg-[radial-gradient(closest-side,rgba(216,191,130,0.18),transparent)]" />
          <h2 className="relative text-3xl font-extrabold tracking-tight sm:text-5xl">
            ¿Hablamos de tu próxima propiedad?
          </h2>
          <p className="relative mt-3 text-[#a8a29a]">Escribinos y un asesor de {site.name} te responde.</p>
          <div className="relative mt-8 flex flex-wrap gap-3">
            <Link
              href="/propiedades"
              className="rounded-xl bg-gradient-to-r from-[#e3cd96] to-[#b99a5b] px-6 py-3 font-semibold text-black transition hover:brightness-110"
            >
              Ver propiedades
            </Link>
            {wa && (
              <a
                href={wa}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-xl border border-white/20 px-6 py-3 font-semibold transition hover:border-[#d8bf82] hover:text-[#d8bf82]"
              >
                <MessageCircle className="size-4" /> WhatsApp
              </a>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
