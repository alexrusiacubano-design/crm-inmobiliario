import { ForbiddenError, getAppraisal, getOrganization, NotFoundError } from "@crm/core";
import { getDb } from "@crm/db";
import { COMPARABLE_KIND_LABELS, COMPARISON_LABELS } from "@crm/shared/appraisal";
import { formatMoney } from "@crm/shared/money";
import {
  PROPERTY_CONDITION_LABELS,
  PROPERTY_OPERATION_LABELS,
  type PropertyCondition,
} from "@crm/shared/property";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { formatDay } from "@/components/properties/format";
import { PrintSheet } from "@/components/print/sheet";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Informe de tasación" };

/** Informe de tasación para entregar al cliente o al propietario. */
export default async function PrintAppraisal({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requireSession();
  const { id } = await params;
  const db = getDb();
  const [org, a] = await Promise.all([
    getOrganization(db, ctx),
    getAppraisal(db, ctx, id).catch((e: unknown) => {
      if (e instanceof NotFoundError) notFound();
      if (e instanceof ForbiddenError) redirect("/forbidden");
      throw e;
    }),
  ]);
  const cur = a.currency;
  const fmt = (n: number | null | undefined) =>
    n === null || n === undefined
      ? "—"
      : formatMoney({ amountMinor: BigInt(Math.round(n * 100)), currency: cur }, { showDecimals: "never" });
  const unitLabel = cur === "USD" ? "US$/m²" : "$/m²";
  const r = a.result;
  const facts: [string, string | null][] = [
    ["Tipo", a.typeLabel],
    ["Operación", PROPERTY_OPERATION_LABELS[a.operation]],
    ["Ubicación", [a.address, a.zone].filter(Boolean).join(" — ") || null],
    ["Superficie edificada", a.builtArea ? `${a.builtArea} m²` : null],
    ["Superficie total", a.totalArea ? `${a.totalArea} m²` : null],
    ["Dormitorios", a.bedrooms !== null ? String(a.bedrooms) : null],
    ["Baños", a.bathrooms !== null ? String(a.bathrooms) : null],
    ["Garajes", a.garages !== null ? String(a.garages) : null],
    ["Año de construcción", a.yearBuilt ? String(a.yearBuilt) : null],
    ["Estado", a.condition ? PROPERTY_CONDITION_LABELS[a.condition as PropertyCondition] : null],
    ["Solicitante", a.clientName],
  ];
  const validComps = a.comparables.map((c, i) => ({ c, row: r.rows[i] })).filter((x) => x.row?.valid);

  return (
    <PrintSheet
      org={org}
      title="Informe de tasación"
      number={a.code}
      date={formatDay(a.valuedAt)}
      back={{ href: `/appraisals/${a.id}`, label: "Tasación" }}
      footer="Estimación de valor de mercado basada en antecedentes comparables a la fecha del informe. No constituye una tasación oficial a efectos bancarios o judiciales."
    >
      <h1 className="text-xl font-semibold">{a.title || `${a.typeLabel}${a.zone ? ` en ${a.zone}` : ""}`}</h1>
      {a.status !== "final" && (
        <p className="mt-1 text-xs font-medium text-amber-700">Borrador — valores sujetos a revisión</p>
      )}

      <section className="mt-5 grid grid-cols-[1fr_auto] gap-6">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[12px]">
          {facts
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-neutral-500">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
        </dl>
        <div className="min-w-56 rounded-md border border-neutral-300 p-4 text-right">
          <p className="text-[11px] tracking-wide text-neutral-500 uppercase">Valor estimado</p>
          <p className="text-2xl font-semibold">{fmt(a.finalValue)}</p>
          {r.min !== null && r.max !== null && (
            <p className="text-[11px] text-neutral-600">
              Rango de mercado {fmt(r.min)} – {fmt(r.max)}
            </p>
          )}
          <p className="mt-2 text-[11px] text-neutral-600">
            {fmt(r.unitAverage)} por m² (promedio homogeneizado)
          </p>
        </div>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold">Antecedentes de mercado</h2>
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="border-b border-neutral-400 text-left text-neutral-600">
              <th className="py-1 pr-2">#</th>
              <th className="py-1 pr-2">Referencia</th>
              <th className="py-1 pr-2 text-right">M²</th>
              <th className="py-1 pr-2">Construcción</th>
              <th className="py-1 pr-2">Ubicación</th>
              <th className="py-1 pr-2">Tipo</th>
              <th className="py-1 pr-2 text-right">Valor</th>
              <th className="py-1 pr-2 text-right">{unitLabel}</th>
              <th className="py-1 text-right">Homog.</th>
            </tr>
          </thead>
          <tbody>
            {validComps.map(({ c, row }, i) => (
              <tr key={i} className="border-b border-neutral-200">
                <td className="py-1 pr-2">A{i + 1}</td>
                <td className="py-1 pr-2">{c.reference || "—"}</td>
                <td className="py-1 pr-2 text-right">{c.m2}</td>
                <td className="py-1 pr-2">{COMPARISON_LABELS[c.construction]}</td>
                <td className="py-1 pr-2">{COMPARISON_LABELS[c.location]}</td>
                <td className="py-1 pr-2">{COMPARABLE_KIND_LABELS[c.kind]}</td>
                <td className="py-1 pr-2 text-right whitespace-nowrap">{fmt(c.price)}</td>
                <td className="py-1 pr-2 text-right whitespace-nowrap">{fmt(row?.unitRaw)}</td>
                <td className="py-1 text-right font-medium whitespace-nowrap">{fmt(row?.unitAdjusted)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[10.5px] leading-relaxed text-neutral-600">
          Método de comparables homogeneizados: el valor por m² de cada antecedente se ajusta por su calidad
          de construcción y ubicación respecto del inmueble tasado (±7 % y ±15 %), y las ofertas publicadas se
          descuentan un {(a.offerDiscountBp / 100).toLocaleString("es-UY")} % por negociación. Mediana{" "}
          {fmt(r.unitMedian)}/m² · mínimo {fmt(r.unitMin)} · máximo {fmt(r.unitMax)} · {r.count} antecedentes.
        </p>
      </section>

      {a.notes && (
        <section className="mt-5">
          <h2 className="mb-1 text-sm font-semibold">Observaciones</h2>
          <p className="text-[12px] whitespace-pre-line">{a.notes}</p>
        </section>
      )}

      <section className="mt-10 grid grid-cols-2 gap-10 text-[11px]">
        <div className="border-t border-neutral-400 pt-1 text-center">
          {a.valuedByName ?? "Tasador"} — {org.name}
        </div>
        <div />
      </section>
    </PrintSheet>
  );
}
