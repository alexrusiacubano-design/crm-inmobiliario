import { getOrganization, getProperty, NotFoundError, ValidationError } from "@crm/core";
import { getDb } from "@crm/db";
import {
  EXPENSE_KIND_LABELS,
  EXPENSE_PERIOD_LABELS,
  PROPERTY_FEATURE_LABELS,
  PROPERTY_OPERATION_LABELS,
  PROPERTY_TYPE_LABELS,
  type ExpenseKind,
  type ExpensePeriod,
  type PropertyFeature,
  type PropertyOperation,
  type PropertyType,
} from "@crm/shared";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { price } from "@/components/properties/format";
import { PrintSheet } from "@/components/print/sheet";
import { requireSession } from "@/lib/session";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Ficha de propiedad" };

/** Ficha comercial para entregar a clientes: sin dirección exacta, propietarios ni datos internos. */
export default async function PrintProperty({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requireSession();
  const { id } = await params;
  const db = getDb();
  const [org, data] = await Promise.all([
    getOrganization(db, ctx),
    getProperty(db, ctx, id).catch((e: unknown) => {
      if (e instanceof NotFoundError || e instanceof ValidationError) notFound();
      throw e;
    }),
  ]);
  const p = data.property;
  const photos = data.media
    .filter((m) => m.kind === "photo")
    .sort((a, b) => Number(b.isCover) - Number(a.isCover));
  const zone = [...new Set([data.zone.neighborhood, data.zone.locality, data.zone.department])]
    .filter(Boolean)
    .join(", ");
  const facts: [string, string | null][] = [
    ["Tipo", PROPERTY_TYPE_LABELS[p.type as PropertyType]],
    ["Dormitorios", p.bedrooms !== null ? String(p.bedrooms) : null],
    ["Baños", p.bathrooms !== null ? String(p.bathrooms) : null],
    ["Garajes", p.garages !== null ? String(p.garages) : null],
    ["Superficie edificada", p.builtArea ? `${Number(p.builtArea)} m²` : null],
    ["Superficie total", p.totalArea ? `${Number(p.totalArea)} m²` : null],
    ["Año de construcción", p.yearBuilt ? String(p.yearBuilt) : null],
  ];
  return (
    <PrintSheet
      org={org}
      title="Ficha de propiedad"
      number={p.code}
      date={formatDateTime(new Date())}
      back={{ href: `/properties/${p.id}`, label: "Propiedad" }}
    >
      <h1 className="text-xl font-semibold">{data.displayTitle}</h1>
      <p className="mb-4 text-neutral-600">{zone}</p>
      {photos[0] && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/media/${photos[0].id}`}
          alt=""
          className="mb-2 h-[85mm] w-full rounded object-cover"
        />
      )}
      {photos.length > 1 && (
        <div className="mb-5 grid grid-cols-4 gap-2">
          {photos.slice(1, 5).map((m) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={m.id}
              src={`/api/media/${m.id}?size=thumb`}
              alt=""
              className="h-[28mm] w-full rounded object-cover"
            />
          ))}
        </div>
      )}
      <section className="mb-5 flex flex-wrap gap-x-8 gap-y-1">
        {data.prices
          .filter((x) => x.listMinor !== null)
          .map((x) => (
            <p key={x.operation} className="text-base">
              {PROPERTY_OPERATION_LABELS[x.operation as PropertyOperation]}:{" "}
              <strong>{price(x.listMinor, x.currency)}</strong>
            </p>
          ))}
      </section>
      <section className="mb-5 grid grid-cols-3 gap-x-6 gap-y-2 text-[12px]">
        {facts
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k}>
              <p className="text-neutral-500">{k}</p>
              <p className="font-medium">{v}</p>
            </div>
          ))}
        {data.expenses.map((e) => (
          <div key={e.id}>
            <p className="text-neutral-500">{EXPENSE_KIND_LABELS[e.kind as ExpenseKind]}</p>
            <p className="font-medium">
              {price(e.amountMinor, e.currency)}{" "}
              {EXPENSE_PERIOD_LABELS[e.period as ExpensePeriod].toLowerCase()}
            </p>
          </div>
        ))}
      </section>
      {p.description && <p className="mb-5 whitespace-pre-line">{p.description}</p>}
      {p.features.length > 0 && (
        <p className="mb-5 text-[12px]">
          <span className="text-neutral-500">Comodidades: </span>
          {p.features.map((f) => PROPERTY_FEATURE_LABELS[f as PropertyFeature] ?? f).join(" · ")}
        </p>
      )}
      <section className="rounded border border-neutral-300 p-3 text-[12px]">
        <p className="font-semibold">Consultas</p>
        <p>
          {[data.assignedName, org.phone, org.email].filter(Boolean).join(" · ") || org.name} · Ref. {p.code}
        </p>
      </section>
    </PrintSheet>
  );
}
