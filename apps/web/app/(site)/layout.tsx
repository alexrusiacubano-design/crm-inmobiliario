import { activeBotToken } from "@crm/core";
import { getDb } from "@crm/db";
import type { Metadata } from "next";
import localFont from "next/font/local";
import Link from "next/link";
import Script from "next/script";
import { getSite, whatsappLink } from "@/lib/site";

const serif = localFont({
  src: [
    { path: "./fonts/cormorant-garamond-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/cormorant-garamond-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/cormorant-garamond-latin-500-italic.woff2", weight: "500", style: "italic" },
  ],
  variable: "--font-serif",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSite();
  const name = site?.name ?? "Inmobiliaria";
  return {
    title: { default: `${name} · Propiedades`, template: `%s · ${name}` },
    description: `Propiedades en venta y alquiler de ${name}.`,
    icons: site?.logoUrl ? { icon: site.logoUrl, apple: site.logoUrl } : undefined,
  };
}

export const dynamic = "force-dynamic";

/** Sitio público de la inmobiliaria: siempre en claro, independiente del tema del CRM. */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const site = await getSite();
  const bot = site ? await activeBotToken(getDb(), site.id).catch(() => null) : null;
  const name = site?.name ?? "Inmobiliaria";
  const wa = whatsappLink(site?.phone, `Hola ${name}, quisiera hacer una consulta.`);
  return (
    <div
      className={`${serif.variable} site min-h-dvh bg-[#faf8f5] text-[#1c1b19] antialiased`}
      style={{ colorScheme: "light" }}
    >
      <header className="sticky top-0 z-40 border-b border-[#e7e2da] bg-[#faf8f5]/90 backdrop-blur">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/propiedades" className="flex min-w-0 items-center gap-3">
            {site?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={site.logoUrl}
                alt=""
                className="size-12 shrink-0 rounded-md bg-neutral-950 object-contain p-0.5"
              />
            ) : null}
            <span className="truncate font-[family-name:var(--font-serif)] text-2xl font-semibold tracking-wide">
              {name}
            </span>
          </Link>
          <nav className="flex items-center gap-1 text-sm sm:gap-2">
            <Link href="/propiedades?operacion=venta" className="rounded-full px-3 py-2 hover:bg-[#efeae2]">
              Venta
            </Link>
            <Link
              href="/propiedades?operacion=alquiler"
              className="rounded-full px-3 py-2 hover:bg-[#efeae2]"
            >
              Alquiler
            </Link>
            <a
              href="#contacto"
              className="hidden rounded-full border border-[#1c1b19] px-4 py-2 transition hover:bg-[#1c1b19] hover:text-white sm:inline-block"
            >
              Contacto
            </a>
          </nav>
        </div>
      </header>

      <main>{children}</main>

      <footer id="contacto" className="mt-20 border-t border-[#e7e2da] bg-white">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-3">
          <div>
            <p className="font-[family-name:var(--font-serif)] text-2xl font-semibold">{name}</p>
            <p className="mt-2 max-w-xs text-sm leading-relaxed text-[#6b665e]">
              Propiedades seleccionadas en venta y alquiler. Te acompañamos en cada paso.
            </p>
          </div>
          <div className="space-y-1.5 text-sm">
            <p className="mb-3 text-xs font-medium tracking-[0.2em] text-[#8a847a] uppercase">Contacto</p>
            {site?.phone && <p>Tel. {site.phone}</p>}
            {site?.email && (
              <p>
                <a className="hover:underline" href={`mailto:${site.email}`}>
                  {site.email}
                </a>
              </p>
            )}
            {site?.address && <p className="text-[#6b665e]">{site.address}</p>}
            {wa && (
              <a
                href={wa}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-2 rounded-full bg-[#1c1b19] px-4 py-2 text-white hover:bg-black"
              >
                Escribinos por WhatsApp
              </a>
            )}
          </div>
          <div className="text-sm md:text-right">
            <p className="mb-3 text-xs font-medium tracking-[0.2em] text-[#8a847a] uppercase">Explorar</p>
            <p>
              <Link className="hover:underline" href="/propiedades?operacion=venta">
                Propiedades en venta
              </Link>
            </p>
            <p className="mt-1.5">
              <Link className="hover:underline" href="/propiedades?operacion=alquiler">
                Propiedades en alquiler
              </Link>
            </p>
            <p className="mt-6 text-xs text-[#8a847a]">
              © {new Date().getFullYear()} {name} ·{" "}
              <Link href="/login" className="hover:underline">
                Acceso agentes
              </Link>
            </p>
          </div>
        </div>
      </footer>
      {bot ? <Script src={`/api/bot/${bot}/widget`} strategy="lazyOnload" /> : null}
    </div>
  );
}
