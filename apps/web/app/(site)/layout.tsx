import { activeBotToken, siteHighlights } from "@crm/core";
import { getDb } from "@crm/db";
import { Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import Script from "next/script";
import { SiteNav } from "@/components/site/site-nav";
import { getSite, whatsappLink } from "@/lib/site";

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSite();
  const name = site?.name ?? "Inmobiliaria";
  return {
    title: { default: `${name} · Propiedades`, template: `%s · ${name}` },
    description: `Casas, apartamentos, oficinas y terrenos en venta y alquiler con ${name}.`,
    icons: site?.logoUrl ? { icon: site.logoUrl, apple: site.logoUrl } : undefined,
    other: { "theme-color": "#0a0a0a" },
  };
}

export const dynamic = "force-dynamic";

const NAV = [
  { href: "/", label: "Inicio" },
  { href: "/propiedades?operacion=venta", label: "Comprar" },
  { href: "/propiedades?operacion=alquiler", label: "Alquilar" },
  { href: "/#tasar", label: "Tasar" },
  { href: "#contacto", label: "Contacto" },
];

/** Sitio público de la inmobiliaria: estética oscura con acentos dorados, independiente del CRM. */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const site = await getSite();
  const db = getDb();
  const [bot, highlights] = site
    ? await Promise.all([
        activeBotToken(db, site.id).catch(() => null),
        siteHighlights(db, site.id).catch(() => ({ closedDeals: 0, offices: [] })),
      ])
    : [null, { closedDeals: 0, offices: [] }];
  const name = site?.name ?? "Inmobiliaria";
  const wa = whatsappLink(site?.phone, `Hola ${name}, quisiera hacer una consulta.`);
  return (
    <div className="site min-h-dvh bg-[#0a0a0a] text-[#f2efe9] antialiased" style={{ colorScheme: "dark" }}>
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0a0a0a]/85 backdrop-blur-md">
        <div className="mx-auto flex h-18 max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/" className="flex min-w-0 items-center gap-3">
            {site?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={site.logoUrl} alt="" className="size-11 shrink-0 rounded-md object-contain" />
            ) : null}
            <span className="truncate text-lg font-bold tracking-[0.12em] text-[#d8bf82] uppercase">
              {name}
            </span>
          </Link>
          <SiteNav items={NAV} whatsapp={wa} />
        </div>
      </header>

      <main>{children}</main>

      <footer id="contacto" className="border-t border-white/10 bg-[#070707]">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.2fr_1fr_1.4fr]">
          <div>
            <div className="flex items-center gap-3">
              {site?.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={site.logoUrl} alt="" className="size-12 rounded-md object-contain" />
              ) : null}
              <p className="text-xl font-bold tracking-[0.12em] text-[#d8bf82] uppercase">{name}</p>
            </div>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-[#a8a29a]">
              Propiedades seleccionadas en venta y alquiler, con asesoramiento en cada paso hasta la firma.
            </p>
            <div className="mt-6 space-y-1.5 text-sm">
              <p className="mb-3 text-xs font-semibold tracking-[0.2em] text-[#d8bf82] uppercase">Explorar</p>
              {NAV.slice(1, 4).map((n) => (
                <p key={n.href}>
                  <Link className="text-[#cfc9bf] hover:text-[#d8bf82]" href={n.href}>
                    {n.label}
                  </Link>
                </p>
              ))}
            </div>
          </div>

          <div className="space-y-3 text-sm">
            <p className="mb-3 text-xs font-semibold tracking-[0.2em] text-[#d8bf82] uppercase">Contacto</p>
            {site?.email && (
              <a
                href={`mailto:${site.email}`}
                className="flex items-center gap-2 text-[#cfc9bf] hover:text-[#d8bf82]"
              >
                <Mail className="size-4" /> {site.email}
              </a>
            )}
            {site?.phone && (
              <p className="flex items-center gap-2 text-[#cfc9bf]">
                <Phone className="size-4" /> {site.phone}
              </p>
            )}
            {wa && (
              <a
                href={wa}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-[#cfc9bf] hover:text-[#d8bf82]"
              >
                <MessageCircle className="size-4" /> Escribinos por WhatsApp
              </a>
            )}
            {site?.address && !highlights.offices.length && (
              <p className="flex items-start gap-2 text-[#a8a29a]">
                <MapPin className="mt-0.5 size-4 shrink-0" /> {site.address}
              </p>
            )}
          </div>

          {highlights.offices.length > 0 && (
            <div className="text-sm">
              <p className="mb-3 text-xs font-semibold tracking-[0.2em] text-[#d8bf82] uppercase">Oficinas</p>
              <div className="grid gap-4 sm:grid-cols-2">
                {highlights.offices.map((o) => (
                  <div key={o.name}>
                    <p className="font-semibold">{o.name}</p>
                    {o.address && (
                      <p className="mt-0.5 flex items-start gap-1.5 text-[#a8a29a]">
                        <MapPin className="mt-0.5 size-3.5 shrink-0" /> {o.address}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="border-t border-white/10">
          <p className="mx-auto max-w-7xl px-4 py-5 text-xs text-[#8c867c] sm:px-6">
            © {new Date().getFullYear()} {name}. Todos los derechos reservados. ·{" "}
            <Link href="/login" className="hover:text-[#d8bf82]">
              Acceso agentes
            </Link>
          </p>
        </div>
      </footer>
      {bot ? <Script src={`/api/bot/${bot}/widget`} strategy="lazyOnload" /> : null}
    </div>
  );
}
