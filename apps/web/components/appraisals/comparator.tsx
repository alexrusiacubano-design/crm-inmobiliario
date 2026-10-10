"use client";

import { PROPERTY_TYPE_LABELS, PROPERTY_TYPES } from "@crm/shared/crm";
import { formatMoney } from "@crm/shared/money";
import { PROPERTY_OPERATION_LABELS, PROPERTY_OPERATIONS } from "@crm/shared/property";
import { Calculator, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { Geo } from "@/components/crm/search-profile-form";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { Badge, Card } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

type Currency = "USD" | "UYU";
export interface ComparatorFilters {
  operation: string;
  propertyType: string;
  departmentId: string;
  localityId: string;
  neighborhoodId: string;
  minArea: string;
  maxArea: string;
  bedrooms: string;
  currency: Currency;
}
interface Row {
  kind: "real" | "offer";
  propertyId: string;
  code: string;
  title: string;
  typeLabel: string;
  zone: string;
  area: number;
  bedrooms: number | null;
  price: number;
  unit: number;
  date: string | null;
}
interface Stat {
  count: number;
  average: number;
  median: number;
  min: number;
  max: number;
}

const fmt = (n: number, c: Currency) =>
  formatMoney({ amountMinor: BigInt(Math.round(n * 100)), currency: c }, { showDecimals: "never" });

export function ComparatorFiltersForm({ initial, geo }: { initial: ComparatorFilters; geo: Geo }) {
  const router = useRouter();
  const [f, setF] = useState(initial);
  const set = (k: keyof ComparatorFilters, v: string) => setF((p) => ({ ...p, [k]: v }));
  const localities = useMemo(
    () => geo.localities.filter((l) => String(l.departmentId) === f.departmentId),
    [geo.localities, f.departmentId],
  );
  const neighborhoods = useMemo(
    () => geo.neighborhoods.filter((n) => String(n.localityId) === f.localityId),
    [geo.neighborhoods, f.localityId],
  );
  return (
    <Card className="mb-5 p-4">
      <form
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
        onSubmit={(e) => {
          e.preventDefault();
          const q = new URLSearchParams();
          for (const [k, v] of Object.entries(f)) if (v) q.set(k, v);
          router.push(`/appraisals/comparator?${q.toString()}`);
        }}
      >
        <Field label="Operación" htmlFor="cf-op">
          <Select id="cf-op" value={f.operation} onChange={(e) => set("operation", e.target.value)}>
            {PROPERTY_OPERATIONS.map((o) => (
              <option key={o} value={o}>
                {PROPERTY_OPERATION_LABELS[o]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tipo" htmlFor="cf-type">
          <Select id="cf-type" value={f.propertyType} onChange={(e) => set("propertyType", e.target.value)}>
            <option value="">Todos</option>
            {PROPERTY_TYPES.map((t) => (
              <option key={t} value={t}>
                {PROPERTY_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Departamento" htmlFor="cf-dep">
          <Select
            id="cf-dep"
            value={f.departmentId}
            onChange={(e) =>
              setF((p) => ({ ...p, departmentId: e.target.value, localityId: "", neighborhoodId: "" }))
            }
          >
            <option value="">Todos</option>
            {geo.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Localidad" htmlFor="cf-loc">
          <Select
            id="cf-loc"
            value={f.localityId}
            disabled={!localities.length}
            onChange={(e) => setF((p) => ({ ...p, localityId: e.target.value, neighborhoodId: "" }))}
          >
            <option value="">Todas</option>
            {localities.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Barrio" htmlFor="cf-nb">
          <Select
            id="cf-nb"
            value={f.neighborhoodId}
            disabled={!neighborhoods.length}
            onChange={(e) => set("neighborhoodId", e.target.value)}
          >
            <option value="">Todos</option>
            {neighborhoods.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="M² desde" htmlFor="cf-min">
          <Input
            id="cf-min"
            inputMode="numeric"
            value={f.minArea}
            onChange={(e) => set("minArea", e.target.value)}
          />
        </Field>
        <Field label="M² hasta" htmlFor="cf-max">
          <Input
            id="cf-max"
            inputMode="numeric"
            value={f.maxArea}
            onChange={(e) => set("maxArea", e.target.value)}
          />
        </Field>
        <Field label="Dormitorios (mín.)" htmlFor="cf-bed">
          <Input
            id="cf-bed"
            inputMode="numeric"
            value={f.bedrooms}
            onChange={(e) => set("bedrooms", e.target.value)}
          />
        </Field>
        <Field label="Moneda" htmlFor="cf-cur">
          <Select id="cf-cur" value={f.currency} onChange={(e) => set("currency", e.target.value)}>
            <option value="USD">Dólares (U$S)</option>
            <option value="UYU">Pesos ($)</option>
          </Select>
        </Field>
        <div className="flex items-end">
          <Button type="submit" className="w-full">
            <Search /> Comparar
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function ComparatorResults({
  rows,
  stats,
  filters,
  canAppraise,
  rate,
}: {
  rows: Row[];
  stats: { all: Stat | null; real: Stat | null; offer: Stat | null };
  filters: ComparatorFilters;
  canAppraise: boolean;
  rate: number;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const cur = filters.currency;
  const unitLabel = cur === "USD" ? "US$/m²" : "$/m²";
  const toggle = (code: string) =>
    setSelected((s) => (s.includes(code) ? s.filter((x) => x !== code) : s.length >= 20 ? s : [...s, code]));
  const useHref = (() => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) q.set(k, v);
    q.set("codes", selected.join(","));
    return `/appraisals/new?${q.toString()}`;
  })();

  const StatCard = ({ title, s, hint }: { title: string; s: Stat | null; hint: string }) => (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{title}</p>
      <p className="mt-1 text-2xl font-semibold tabular">{s ? fmt(s.average, cur) : "—"}</p>
      <p className="text-xs text-muted-foreground">
        {s ? `${unitLabel} promedio · mediana ${fmt(s.median, cur)} · ${s.count} casos` : hint}
      </p>
      {s && (
        <p className="mt-1 text-xs text-muted-foreground tabular">
          Rango {fmt(s.min, cur)} – {fmt(s.max, cur)}
        </p>
      )}
    </Card>
  );

  return (
    <>
      <div className="mb-5 grid gap-3 md:grid-cols-3">
        <StatCard
          title="Valores reales (operaciones cerradas)"
          s={stats.real}
          hint="Sin operaciones cerradas con estos filtros"
        />
        <StatCard
          title="Ofertas (precios publicados)"
          s={stats.offer}
          hint="Sin propiedades publicadas con estos filtros"
        />
        <StatCard title="Todos los casos" s={stats.all} hint="Sin datos" />
      </div>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3">
          <p className="text-sm text-muted-foreground">
            Montos convertidos a {cur === "USD" ? "dólares" : "pesos"} con {rate.toFixed(2).replace(".", ",")}{" "}
            $ por dólar.
            {canAppraise && " Marcá los casos que quieras usar como antecedentes."}
          </p>
          {canAppraise && (
            <Button asChild size="sm" variant={selected.length ? "primary" : "secondary"}>
              <Link href={selected.length ? useHref : "/appraisals/new"} aria-disabled={!selected.length}>
                <Calculator />{" "}
                {selected.length
                  ? `Tasar con ${selected.length} antecedente${selected.length === 1 ? "" : "s"}`
                  : "Nueva tasación"}
              </Link>
            </Button>
          )}
        </div>
        {rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            No hay propiedades ni operaciones del CRM con esos filtros. Probá ampliando la zona o la
            superficie.
          </p>
        ) : (
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                {canAppraise && <TH className="w-8" />}
                <TH>Propiedad</TH>
                <TH>Tipo de dato</TH>
                <TH className="text-right">M²</TH>
                <TH className="text-right">Dorm.</TH>
                <TH className="text-right">Precio</TH>
                <TH className="text-right">{unitLabel}</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={`${r.kind}-${r.code}-${r.date}`}>
                  {canAppraise && (
                    <TD>
                      <Checkbox
                        checked={selected.includes(r.code)}
                        onChange={() => toggle(r.code)}
                        aria-label={`Usar ${r.code}`}
                      />
                    </TD>
                  )}
                  <TD>
                    <Link href={`/properties/${r.propertyId}`} className="hover:underline">
                      {r.title}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {[r.code, r.typeLabel, r.zone].filter(Boolean).join(" · ")}
                    </span>
                  </TD>
                  <TD>
                    <Badge tone={r.kind === "real" ? "success" : "outline"}>
                      {r.kind === "real" ? "Real" : "Oferta"}
                    </Badge>
                    {r.date && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {r.date.split("-").reverse().join("/")}
                      </span>
                    )}
                  </TD>
                  <TD className="text-right tabular">{r.area}</TD>
                  <TD className="text-right tabular">{r.bedrooms ?? "—"}</TD>
                  <TD className="text-right tabular">{fmt(r.price, cur)}</TD>
                  <TD className="text-right font-semibold tabular">{fmt(r.unit, cur)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
