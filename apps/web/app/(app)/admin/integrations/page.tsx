import { listExchangeRates, listPortalAccounts, listPublications } from "@crm/core";
import { EXCHANGE_SOURCE_LABELS } from "@crm/shared/publications";
import { getDb } from "@crm/db";
import type { Metadata } from "next";
import { headers } from "next/headers";
import {
  ExchangeRateForm,
  PortalAccountCard,
  type PortalAccountView,
} from "@/components/publications/integrations";
import { Badge, Card, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requirePagePermission } from "@/lib/session";
import { DEFAULT_TZ, ymdInTz } from "@/lib/tz";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Integraciones" };

function ymdLabel(d: string) {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

export default async function IntegrationsPage() {
  const { ctx } = await requirePagePermission("integrations.manage");
  const db = getDb();
  const tz = ctx.organization.timezone || DEFAULT_TZ;
  const today = ymdInTz(new Date(), tz);
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${proto}://${host}`;

  const [accounts, pubs, rates] = await Promise.all([
    listPortalAccounts(db, ctx),
    listPublications(db, ctx, { today }),
    listExchangeRates(db, ctx),
  ]);
  const views: PortalAccountView[] = accounts.map((a) => ({
    portal: a.portal,
    enabled: a.enabled,
    accountRef: a.accountRef,
    quotas: a.quotas,
    feedUrl: a.feedToken ? `${origin}/api/feeds/${a.feedToken}` : null,
    used: pubs.portals.find((p) => p.portal === a.portal)?.used ?? {},
  }));

  const storage = process.env.STORAGE_DRIVER === "s3" ? "S3 / compatible" : "Disco local";
  const services: { name: string; status: string; ok: boolean; note: string }[] = [
    {
      name: "Almacenamiento de archivos",
      status: storage,
      ok: process.env.STORAGE_DRIVER === "s3" || process.env.NODE_ENV !== "production",
      note: "Fotos y documentos. En producción conviene S3 (o Supabase Storage / R2 por API S3).",
    },
    {
      name: "Formulario web y portales → Bandeja",
      status: process.env.INQUIRY_WEBHOOK_SECRET ? "Configurado" : "Sin clave",
      ok: Boolean(process.env.INQUIRY_WEBHOOK_SECRET),
      note: `POST ${origin}/api/inquiries con el encabezado x-crm-key.`,
    },
    {
      name: "WhatsApp",
      status: "Enlaces wa.me",
      ok: true,
      note: "Los mensajes se abren en WhatsApp con la plantilla y quedan registrados. La API oficial de Meta es opcional.",
    },
    {
      name: "Email",
      status: "Cliente de correo",
      ok: true,
      note: "Se abre tu programa de correo con la plantilla; el envío automático se suma con un proveedor SMTP.",
    },
    {
      name: "Facturación electrónica (CFE / DGI)",
      status: "No conectada",
      ok: false,
      note: "Se integra con un proveedor habilitado por DGI en una fase posterior.",
    },
  ];

  return (
    <>
      <PageHeader
        title="Integraciones"
        description="Portales inmobiliarios, cotización del dólar y estado de los servicios externos."
      />

      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">Portales</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {views.map((a) => (
            <PortalAccountCard key={a.portal} a={a} />
          ))}
        </div>
      </section>

      <section className="mt-8 grid gap-3">
        <h2 className="text-lg font-semibold">Tipo de cambio (dólar billete)</h2>
        <Card className="grid gap-4 p-4">
          <p className="text-sm">
            Cotización de referencia:{" "}
            <span className="font-semibold">
              {rates.current ? `$ ${Number(rates.current).toFixed(2).replace(".", ",")}` : "sin cargar"}
            </span>
            <span className="text-muted-foreground">
              {" "}
              · se usa para comparar precios en distintas monedas, el matching y los reportes.
            </span>
          </p>
          <ExchangeRateForm today={today} />
          {rates.items.length > 0 && (
            <Table>
              <THead>
                <TR>
                  <TH>Fecha</TH>
                  <TH className="text-right">Pesos por dólar</TH>
                  <TH>Origen</TH>
                  <TH>Cargado</TH>
                </TR>
              </THead>
              <TBody>
                {rates.items.map((r) => (
                  <TR key={r.id}>
                    <TD>{ymdLabel(r.date)}</TD>
                    <TD className="text-right tabular-nums">
                      {Number(r.uyuPerUsd).toFixed(2).replace(".", ",")}
                    </TD>
                    <TD>{EXCHANGE_SOURCE_LABELS[r.source]}</TD>
                    <TD className="text-xs text-muted-foreground">
                      {[r.createdByName, formatDateTime(r.createdAt)].filter(Boolean).join(" · ")}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </section>

      <section className="mt-8 grid gap-3">
        <h2 className="text-lg font-semibold">Servicios</h2>
        <Card className="divide-y">
          {services.map((s) => (
            <div key={s.name} className="flex flex-wrap items-start justify-between gap-2 p-4">
              <div className="min-w-0">
                <p className="font-medium">{s.name}</p>
                <p className="text-xs text-muted-foreground">{s.note}</p>
              </div>
              <Badge tone={s.ok ? "success" : "neutral"}>{s.status}</Badge>
            </div>
          ))}
        </Card>
      </section>
    </>
  );
}
