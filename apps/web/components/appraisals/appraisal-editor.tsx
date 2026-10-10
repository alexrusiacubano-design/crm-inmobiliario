"use client";

import {
  appraisalArea,
  COMPARABLE_KIND_LABELS,
  COMPARISON_LABELS,
  COMPARISON_LEVELS,
  computeAppraisal,
  type AppraisalComparable,
  type ComparableKind,
  type ComparisonLevel,
} from "@crm/shared/appraisal";
import { PROPERTY_TYPE_LABELS, PROPERTY_TYPES, type PropertyType } from "@crm/shared/crm";
import { formatMoney } from "@crm/shared/money";
import {
  PROPERTY_CONDITION_LABELS,
  PROPERTY_CONDITIONS,
  PROPERTY_OPERATION_LABELS,
  PROPERTY_OPERATIONS,
  type PropertyCondition,
  type PropertyOperation,
} from "@crm/shared/property";
import { parseLocaleNumber } from "@crm/shared/validation/appraisal";
import { Plus, Printer, Save, Search, Trash2, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { saveAppraisalAction } from "@/app/(app)/appraisals/actions";
import type { Geo } from "@/components/crm/search-profile-form";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Badge, Card } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import type { AppraisalEditorInitial } from "./defaults";

type Currency = "USD" | "UYU";

interface CompRow {
  key: string;
  reference: string;
  m2: string;
  construction: ComparisonLevel;
  location: ComparisonLevel;
  kind: ComparableKind;
  price: string;
  sourceCode: string | null;
}

const num = (v: string): number | null => {
  if (!v.trim()) return null;
  const n = parseLocaleNumber(v);
  return Number.isFinite(n) ? n : null;
};
const fmt = (n: number | null | undefined, c: Currency) =>
  n === null || n === undefined
    ? "—"
    : formatMoney({ amountMinor: BigInt(Math.round(n * 100)), currency: c }, { showDecimals: "never" });
let seq = 0;
const newKey = () => `c${Date.now().toString(36)}${(seq++).toString(36)}`;
const emptyRow = (): CompRow => ({
  key: newKey(),
  reference: "",
  m2: "",
  construction: 0,
  location: 0,
  kind: "real",
  price: "",
  sourceCode: null,
});

export function AppraisalEditor({
  initial,
  geo,
  canPrint,
}: {
  initial: AppraisalEditorInitial;
  geo: Geo;
  canPrint?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [v, setV] = useState(() => {
    const { comparables: _c, ...rest } = initial;
    return rest;
  });
  const [rows, setRows] = useState<CompRow[]>(() => {
    const r = initial.comparables.map((c) => ({
      key: newKey(),
      reference: c.reference,
      m2: c.m2?.toString() ?? "",
      construction: c.construction,
      location: c.location,
      kind: c.kind,
      price: c.price?.toString() ?? "",
      sourceCode: c.sourceCode ?? null,
    }));
    while (r.length < 4) r.push(emptyRow());
    return r;
  });
  const set = <K extends keyof typeof v>(k: K, value: (typeof v)[K]) => setV((p) => ({ ...p, [k]: value }));
  const setRow = (key: string, patch: Partial<CompRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const localities = useMemo(
    () => geo.localities.filter((l) => String(l.departmentId) === v.departmentId),
    [geo.localities, v.departmentId],
  );
  const neighborhoods = useMemo(
    () => geo.neighborhoods.filter((n) => String(n.localityId) === v.localityId),
    [geo.neighborhoods, v.localityId],
  );

  const comparables: AppraisalComparable[] = rows.map((r) => ({
    reference: r.reference,
    m2: num(r.m2),
    construction: r.construction,
    location: r.location,
    kind: r.kind,
    price: num(r.price),
    sourceCode: r.sourceCode,
  }));
  const offerBp = Math.round((num(v.offerDiscount) ?? 0) * 100);
  const area = appraisalArea(num(v.builtArea), num(v.totalArea));
  const result = computeAppraisal({ area, comparables, offerDiscountBp: offerBp, currency: v.currency });
  const cur = v.currency;
  const unitLabel = cur === "USD" ? "US$/m²" : "$/m²";
  const dispersion = result.dispersion;
  const dispersionTone =
    dispersion === null
      ? "neutral"
      : dispersion <= 0.1
        ? "success"
        : dispersion <= 0.2
          ? "warning"
          : "danger";
  const finalValue = num(v.adoptedValue) ?? result.value;

  const comparatorHref = (() => {
    const q = new URLSearchParams({ operation: v.operation, propertyType: v.propertyType, currency: cur });
    if (v.neighborhoodId) q.set("neighborhoodId", v.neighborhoodId);
    else if (v.localityId) q.set("localityId", v.localityId);
    else if (v.departmentId) q.set("departmentId", v.departmentId);
    if (area) {
      q.set("minArea", String(Math.round(area * 0.6)));
      q.set("maxArea", String(Math.round(area * 1.4)));
    }
    return `/appraisals/comparator?${q.toString()}`;
  })();

  const save = (status: "draft" | "final") =>
    start(async () => {
      const r = await saveAppraisalAction({
        id: v.id ?? null,
        status,
        title: v.title,
        address: v.address,
        propertyType: v.propertyType,
        operation: v.operation,
        departmentId: v.departmentId || null,
        localityId: v.localityId || null,
        neighborhoodId: v.neighborhoodId || null,
        builtArea: num(v.builtArea),
        totalArea: num(v.totalArea),
        bedrooms: num(v.bedrooms),
        bathrooms: num(v.bathrooms),
        garages: num(v.garages),
        yearBuilt: num(v.yearBuilt),
        condition: v.condition || null,
        clientName: v.clientName,
        currency: cur,
        offerDiscountBp: offerBp,
        comparables: comparables.filter((c) => c.reference || c.m2 || c.price),
        adoptedValue: num(v.adoptedValue),
        notes: v.notes,
      });
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        toast.error(r.error);
        return;
      }
      setErrors({});
      toast.success(
        status === "final" ? `Tasación ${r.data.code} finalizada` : `Tasación ${r.data.code} guardada`,
      );
      if (!v.id) router.replace(`/appraisals/${r.data.id}`);
      else {
        set("status", status);
        router.refresh();
      }
    });

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="grid min-w-0 gap-6">
        <Card className="p-5">
          <h2 className="font-semibold">Inmueble a tasar</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            No hace falta que exista como propiedad en el CRM: describilo acá.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Tipo" htmlFor="t-type">
              <Select
                id="t-type"
                value={v.propertyType}
                onChange={(e) => set("propertyType", e.target.value as PropertyType)}
              >
                {PROPERTY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {PROPERTY_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Operación" htmlFor="t-op">
              <Select
                id="t-op"
                value={v.operation}
                onChange={(e) => set("operation", e.target.value as PropertyOperation)}
              >
                {PROPERTY_OPERATIONS.map((o) => (
                  <option key={o} value={o}>
                    {PROPERTY_OPERATION_LABELS[o]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Moneda" htmlFor="t-cur">
              <Select id="t-cur" value={cur} onChange={(e) => set("currency", e.target.value as Currency)}>
                <option value="USD">Dólares (U$S)</option>
                <option value="UYU">Pesos ($)</option>
              </Select>
            </Field>
            <Field label="Cliente / solicitante" htmlFor="t-client">
              <Input
                id="t-client"
                value={v.clientName}
                placeholder="Opcional"
                onChange={(e) => set("clientName", e.target.value)}
              />
            </Field>
            <Field label="Título" htmlFor="t-title" className="sm:col-span-2" error={errors.title}>
              <Input
                id="t-title"
                value={v.title}
                placeholder="Ej.: Apartamento 2 dormitorios en Pocitos"
                onChange={(e) => set("title", e.target.value)}
              />
            </Field>
            <Field label="Dirección o referencia" htmlFor="t-addr" className="sm:col-span-2">
              <Input id="t-addr" value={v.address} onChange={(e) => set("address", e.target.value)} />
            </Field>
            <Field label="Departamento" htmlFor="t-dep">
              <Select
                id="t-dep"
                value={v.departmentId}
                onChange={(e) =>
                  setV((p) => ({ ...p, departmentId: e.target.value, localityId: "", neighborhoodId: "" }))
                }
              >
                <option value="">Elegí…</option>
                {geo.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Localidad" htmlFor="t-loc">
              <Select
                id="t-loc"
                value={v.localityId}
                disabled={!localities.length}
                onChange={(e) => setV((p) => ({ ...p, localityId: e.target.value, neighborhoodId: "" }))}
              >
                <option value="">{localities.length ? "Elegí…" : "—"}</option>
                {localities.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Barrio" htmlFor="t-nb">
              <Select
                id="t-nb"
                value={v.neighborhoodId}
                disabled={!neighborhoods.length}
                onChange={(e) => set("neighborhoodId", e.target.value)}
              >
                <option value="">{neighborhoods.length ? "Elegí…" : "—"}</option>
                {neighborhoods.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Estado de conservación" htmlFor="t-cond">
              <Select id="t-cond" value={v.condition} onChange={(e) => set("condition", e.target.value)}>
                <option value="">—</option>
                {PROPERTY_CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {PROPERTY_CONDITION_LABELS[c as PropertyCondition]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="M² edificados" htmlFor="t-built" error={errors.builtArea}>
              <Input
                id="t-built"
                inputMode="decimal"
                value={v.builtArea}
                onChange={(e) => set("builtArea", e.target.value)}
              />
            </Field>
            <Field label="M² totales / terreno" htmlFor="t-total" error={errors.totalArea}>
              <Input
                id="t-total"
                inputMode="decimal"
                value={v.totalArea}
                onChange={(e) => set("totalArea", e.target.value)}
              />
            </Field>
            <div className="grid grid-cols-3 gap-2 sm:col-span-2">
              <Field label="Dorm." htmlFor="t-bed">
                <Input
                  id="t-bed"
                  inputMode="numeric"
                  value={v.bedrooms}
                  onChange={(e) => set("bedrooms", e.target.value)}
                />
              </Field>
              <Field label="Baños" htmlFor="t-bath">
                <Input
                  id="t-bath"
                  inputMode="numeric"
                  value={v.bathrooms}
                  onChange={(e) => set("bathrooms", e.target.value)}
                />
              </Field>
              <Field label="Garajes" htmlFor="t-gar">
                <Input
                  id="t-gar"
                  inputMode="numeric"
                  value={v.garages}
                  onChange={(e) => set("garages", e.target.value)}
                />
              </Field>
            </div>
            <Field label="Año de construcción" htmlFor="t-year">
              <Input
                id="t-year"
                inputMode="numeric"
                value={v.yearBuilt}
                onChange={(e) => set("yearBuilt", e.target.value)}
              />
            </Field>
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-1 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">Antecedentes (comparables)</h2>
              <p className="text-sm text-muted-foreground">
                Ventas concretadas (Real) u ofertas publicadas (Oferta) parecidas. Indicá cómo es cada una
                respecto del inmueble tasado: el sistema homogeneiza el valor por m².
              </p>
            </div>
            <Button asChild variant="secondary" size="sm">
              <Link href={comparatorHref}>
                <Search /> Buscar en el comparador
              </Link>
            </Button>
          </div>

          <div className="mt-4 grid gap-3">
            {rows.map((r, idx) => {
              const res = result.rows[idx];
              return (
                <div key={r.key} className="grid gap-3 rounded-lg border bg-surface p-3">
                  <div className="flex items-end gap-3">
                    <span className="flex size-8 items-center justify-center rounded-full border text-xs font-semibold text-muted-foreground">
                      A{idx + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <Field label="Referencia" htmlFor={`${r.key}-ref`}>
                        <Input
                          id={`${r.key}-ref`}
                          value={r.reference}
                          placeholder="Dirección, aviso o código"
                          onChange={(e) => setRow(r.key, { reference: e.target.value })}
                        />
                      </Field>
                    </div>
                    <div className="grid w-28 shrink-0 gap-0.5 text-right">
                      <span className="text-xs text-muted-foreground">{unitLabel}</span>
                      <span className="text-xs text-muted-foreground tabular">{fmt(res?.unitRaw, cur)}</span>
                      <span className="text-sm font-semibold tabular" title="Homogeneizado">
                        {fmt(res?.unitAdjusted, cur)}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Quitar A${idx + 1}`}
                      onClick={() =>
                        setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [emptyRow()]))
                      }
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    <Field label="M²" htmlFor={`${r.key}-m2`}>
                      <Input
                        id={`${r.key}-m2`}
                        inputMode="decimal"
                        value={r.m2}
                        onChange={(e) => setRow(r.key, { m2: e.target.value })}
                      />
                    </Field>
                    <Field label="Construcción" htmlFor={`${r.key}-con`}>
                      <Select
                        id={`${r.key}-con`}
                        value={r.construction}
                        onChange={(e) =>
                          setRow(r.key, { construction: Number(e.target.value) as ComparisonLevel })
                        }
                      >
                        {COMPARISON_LEVELS.map((l) => (
                          <option key={l} value={l}>
                            {COMPARISON_LABELS[l]}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Ubicación" htmlFor={`${r.key}-loc`}>
                      <Select
                        id={`${r.key}-loc`}
                        value={r.location}
                        onChange={(e) =>
                          setRow(r.key, { location: Number(e.target.value) as ComparisonLevel })
                        }
                      >
                        {COMPARISON_LEVELS.map((l) => (
                          <option key={l} value={l}>
                            {COMPARISON_LABELS[l]}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <div className="grid gap-1.5">
                      <span className="text-sm font-medium">Tipo</span>
                      <div className="flex h-9 overflow-hidden rounded-md border">
                        {(["real", "offer"] as const).map((k) => (
                          <button
                            key={k}
                            type="button"
                            onClick={() => setRow(r.key, { kind: k })}
                            className={cn(
                              "flex-1 text-xs",
                              r.kind === k
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:bg-surface-muted",
                            )}
                          >
                            {COMPARABLE_KIND_LABELS[k]}
                          </button>
                        ))}
                      </div>
                    </div>
                    <Field label={cur === "USD" ? "Valor (U$S)" : "Valor ($)"} htmlFor={`${r.key}-price`}>
                      <Input
                        id={`${r.key}-price`}
                        inputMode="decimal"
                        value={r.price}
                        onChange={(e) => setRow(r.key, { price: e.target.value })}
                      />
                    </Field>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={rows.length >= 30}
              onClick={() => setRows((rs) => [...rs, emptyRow()])}
            >
              <Plus /> Agregar antecedente
            </Button>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Descuento de negociación para ofertas
              <Input
                className="h-8 w-16 text-right"
                inputMode="decimal"
                value={v.offerDiscount}
                onChange={(e) => set("offerDiscount", e.target.value)}
                aria-label="Descuento para ofertas (%)"
              />
              %
            </label>
          </div>
        </Card>
      </div>

      <div className="xl:sticky xl:top-20 xl:self-start">
        <Card className="grid gap-4 p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">Resultado</h2>
            {v.code && (
              <Badge tone={v.status === "final" ? "success" : "neutral"}>
                {v.code} · {v.status === "final" ? "Finalizada" : "Borrador"}
              </Badge>
            )}
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Valor estimado</p>
            <p className="text-3xl font-semibold tracking-tight tabular">{fmt(result.value, cur)}</p>
            <p className="text-sm text-muted-foreground tabular">
              Rango {fmt(result.min, cur)} – {fmt(result.max, cur)}
            </p>
            {!area && (
              <p className="mt-1 text-xs text-warning">Cargá los m² del inmueble para calcular el valor.</p>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-3 text-sm">
            <dt className="text-muted-foreground">Promedio {unitLabel}</dt>
            <dd className="text-right font-medium tabular">{fmt(result.unitAverage, cur)}</dd>
            <dt className="text-muted-foreground">Mediana {unitLabel}</dt>
            <dd className="text-right tabular">{fmt(result.unitMedian, cur)}</dd>
            <dt className="text-muted-foreground">Mín. / máx.</dt>
            <dd className="text-right tabular">
              {fmt(result.unitMin, cur)} / {fmt(result.unitMax, cur)}
            </dd>
            <dt className="text-muted-foreground">Antecedentes válidos</dt>
            <dd className="text-right tabular">{result.count}</dd>
            <dt className="text-muted-foreground">Dispersión</dt>
            <dd className="text-right">
              <Badge tone={dispersionTone}>
                {dispersion === null ? "—" : `${(dispersion * 100).toFixed(0)} %`}
              </Badge>
            </dd>
            <dt className="text-muted-foreground">Superficie de cálculo</dt>
            <dd className="text-right tabular">{area ? `${area} m²` : "—"}</dd>
          </dl>
          {result.count > 0 && result.count < 3 && (
            <p className="text-xs text-warning">Conviene usar al menos 3 antecedentes.</p>
          )}
          <Field
            label="Valor adoptado (opcional)"
            htmlFor="t-adopt"
            hint="Si tu criterio difiere del cálculo, este es el valor que figura en el informe."
          >
            <Input
              id="t-adopt"
              inputMode="decimal"
              value={v.adoptedValue}
              placeholder={result.value ? String(result.value) : ""}
              onChange={(e) => set("adoptedValue", e.target.value)}
            />
          </Field>
          <Field label="Observaciones" htmlFor="t-notes">
            <Textarea id="t-notes" rows={3} value={v.notes} onChange={(e) => set("notes", e.target.value)} />
          </Field>
          <div className="rounded-md bg-surface-muted p-3 text-sm">
            <span className="text-muted-foreground">Valor del informe: </span>
            <span className="font-semibold tabular">{fmt(finalValue, cur)}</span>
          </div>
          <div className="grid gap-2">
            <Button type="button" loading={pending} onClick={() => save("final")}>
              <CheckCircle2 /> Finalizar tasación
            </Button>
            <Button type="button" variant="secondary" disabled={pending} onClick={() => save("draft")}>
              <Save /> Guardar borrador
            </Button>
            {v.id && canPrint && (
              <Button asChild variant="ghost">
                <Link href={`/print/tasacion/${v.id}`} target="_blank">
                  <Printer /> Informe para imprimir
                </Link>
              </Button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
