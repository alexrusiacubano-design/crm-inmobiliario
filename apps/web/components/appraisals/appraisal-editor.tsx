"use client";

import {
  appraisalArea,
  COMPARABLE_KIND_LABELS,
  computeAppraisal,
  SCORE_HINT,
  type AppraisalComparable,
  type ComparableKind,
} from "@crm/shared/appraisal";
import { PROPERTY_TYPE_LABELS, PROPERTY_TYPES, type PropertyType } from "@crm/shared/crm";
import {
  PROPERTY_CONDITION_LABELS,
  PROPERTY_CONDITIONS,
  PROPERTY_OPERATION_LABELS,
  PROPERTY_OPERATIONS,
  type PropertyCondition,
  type PropertyOperation,
} from "@crm/shared/property";
import { parseLocaleNumber } from "@crm/shared/validation/appraisal";
import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  ChevronDown,
  Download,
  FileText,
  Plus,
  Save,
  Search,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { saveAppraisalAction } from "@/app/(app)/appraisals/actions";
import type { Geo } from "@/components/crm/search-profile-form";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Badge, Card } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import {
  AdjustedBars,
  CoefficientCards,
  type Currency,
  fmtMoney,
  fmtNum,
  fmtPct,
  MatrixKTable,
  SummaryCards,
  unitLabelOf,
  WarningsBox,
} from "./analysis";
import type { AppraisalEditorInitial } from "./defaults";

interface CompRow {
  key: string;
  reference: string;
  m2: string;
  construction: string;
  location: string;
  kind: ComparableKind;
  price: string;
  sourceCode: string | null;
}

const num = (v: string): number | null => {
  if (!v.trim()) return null;
  const n = parseLocaleNumber(v);
  return Number.isFinite(n) ? n : null;
};
const str = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));
let seq = 0;
const newKey = () => `c${Date.now().toString(36)}${(seq++).toString(36)}`;
const emptyRow = (): CompRow => ({
  key: newKey(),
  reference: "",
  m2: "",
  construction: "",
  location: "",
  kind: "real",
  price: "",
  sourceCode: null,
});

function ScoreInput({
  id,
  value,
  onChange,
  label,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <Input
      id={id}
      inputMode="decimal"
      aria-label={label}
      placeholder="Ej. 3"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="text-center"
    />
  );
}

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
  const [showResults, setShowResults] = useState(Boolean(initial.id));
  const resultsRef = useRef<HTMLDivElement>(null);
  const [v, setV] = useState(() => {
    const { comparables: _c, ...rest } = initial;
    return rest;
  });
  const [rows, setRows] = useState<CompRow[]>(() => {
    const r = initial.comparables.map((c) => ({
      key: newKey(),
      reference: c.reference,
      m2: str(c.m2),
      construction: str(c.construction),
      location: str(c.location),
      kind: c.kind,
      price: str(c.price),
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
    construction: num(r.construction),
    location: num(r.location),
    kind: r.kind,
    price: num(r.price),
    sourceCode: r.sourceCode,
    v: 2,
  }));
  const offerBp = Math.round((num(v.offerDiscount) ?? 0) * 100);
  const area = appraisalArea(num(v.builtArea), num(v.totalArea));
  const subject = {
    m2: area,
    construction: num(v.subjectConstruction),
    location: num(v.subjectLocation),
  };
  const result = computeAppraisal({ subject, comparables, offerDiscountBp: offerBp });
  const cur = v.currency as Currency;
  const unitLabel = unitLabelOf(cur);
  const finalValue = num(v.adoptedValue) ?? result.probable;
  const missingScores =
    subject.construction === null ||
    subject.location === null ||
    comparables.some((c) => c.m2 && c.price && (c.construction === null || c.location === null));

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

  const realize = () => {
    if (result.count === 0) return void toast.error("Cargá al menos un antecedente con m² y valor de venta.");
    if (!area) return void toast.error("Cargá los m² del bien problema.");
    setShowResults(true);
    setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

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
        subjectConstruction: subject.construction,
        subjectLocation: subject.location,
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

  const rowGrid =
    "sm:grid-cols-[2.25rem_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_8.5rem_minmax(0,1.3fr)_minmax(0,1fr)_2rem]";

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="grid min-w-0 grid-cols-1 gap-6">
        {/* ── Antecedentes ─────────────────────────────────────────── */}
        <Card className="min-w-0 p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold">Antecedentes</h2>
                <Badge tone="primary">Método metrológico</Badge>
                {v.code && (
                  <Badge tone={v.status === "final" ? "success" : "neutral"}>
                    {v.code} · {v.status === "final" ? "Finalizada" : "Borrador"}
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Inmuebles comparables vendidos (Real) o publicados (Oferta). Construcción y ubicación se
                puntúan en la misma escala para todos y para el bien problema ({SCORE_HINT}).
              </p>
            </div>
            <Button asChild variant="secondary" size="sm">
              <Link href={comparatorHref}>
                <Search /> Cargar del comparador
              </Link>
            </Button>
          </div>

          <div
            className={cn(
              "hidden gap-2 px-1 pb-1 text-xs font-medium text-muted-foreground sm:grid",
              rowGrid,
            )}
          >
            <span />
            <span>M²</span>
            <span className="text-center">Construcción</span>
            <span className="text-center">Ubicación</span>
            <span>Tipo</span>
            <span>Valor de venta</span>
            <span className="text-right">{unitLabel}</span>
            <span />
          </div>

          <div className="grid gap-2">
            {rows.map((r, idx) => {
              const res = result.rows[idx];
              return (
                <div key={r.key} className="rounded-lg border bg-surface p-2">
                  <div className={cn("grid grid-cols-2 items-center gap-2", rowGrid)}>
                    <span className="col-span-2 flex size-8 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold sm:col-span-1">
                      A{idx + 1}
                    </span>
                    <Field label="M²" htmlFor={`${r.key}-m2`} className="sm:[&>label]:sr-only">
                      <Input
                        id={`${r.key}-m2`}
                        inputMode="decimal"
                        value={r.m2}
                        onChange={(e) => setRow(r.key, { m2: e.target.value })}
                      />
                    </Field>
                    <Field label="Construcción" htmlFor={`${r.key}-con`} className="sm:[&>label]:sr-only">
                      <ScoreInput
                        id={`${r.key}-con`}
                        label={`Construcción A${idx + 1}`}
                        value={r.construction}
                        onChange={(x) => setRow(r.key, { construction: x })}
                      />
                    </Field>
                    <Field label="Ubicación" htmlFor={`${r.key}-loc`} className="sm:[&>label]:sr-only">
                      <ScoreInput
                        id={`${r.key}-loc`}
                        label={`Ubicación A${idx + 1}`}
                        value={r.location}
                        onChange={(x) => setRow(r.key, { location: x })}
                      />
                    </Field>
                    <div className="flex h-9 overflow-hidden rounded-md border">
                      {(["real", "offer"] as const).map((k) => (
                        <button
                          key={k}
                          type="button"
                          aria-pressed={r.kind === k}
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
                    <Field
                      label={cur === "USD" ? "Valor de venta (US$)" : "Valor de venta ($)"}
                      htmlFor={`${r.key}-price`}
                      className="sm:[&>label]:sr-only"
                    >
                      <Input
                        id={`${r.key}-price`}
                        inputMode="decimal"
                        value={r.price}
                        onChange={(e) => setRow(r.key, { price: e.target.value })}
                      />
                    </Field>
                    <span className="self-center text-sm font-medium tabular sm:text-right">
                      <span className="text-xs text-muted-foreground sm:hidden">{unitLabel} </span>
                      {res?.unit ? fmtNum(res.unit, 0) : "—"}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="justify-self-end"
                      aria-label={`Quitar A${idx + 1}`}
                      onClick={() =>
                        setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [emptyRow()]))
                      }
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  <div className="mt-1.5 sm:pl-11">
                    <input
                      aria-label={`Referencia A${idx + 1}`}
                      value={r.reference}
                      placeholder="Referencia (dirección, aviso o código) — opcional"
                      onChange={(e) => setRow(r.key, { reference: e.target.value })}
                      className="w-full bg-transparent text-xs text-muted-foreground outline-none placeholder:text-muted-foreground/60"
                    />
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
              <Plus /> Añadir antecedente
            </Button>
            <p className="text-sm">
              <span className="text-muted-foreground">Promedio {unitLabel}: </span>
              <span className="font-semibold tabular">{fmtNum(result.unitAverage, 0)}</span>
            </p>
          </div>
          <label className="mt-3 flex items-center justify-end gap-2 text-xs text-muted-foreground">
            Descuento de negociación sobre ofertas
            <Input
              className="h-7 w-14 text-right text-xs"
              inputMode="decimal"
              value={v.offerDiscount}
              onChange={(e) => set("offerDiscount", e.target.value)}
              aria-label="Descuento para ofertas (%)"
            />
            %
          </label>
        </Card>

        {/* ── Bien problema ────────────────────────────────────────── */}
        <Card className="p-5">
          <h2 className="font-semibold">Bien problema</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            El inmueble a tasar. No hace falta que exista como propiedad en el CRM.
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="M²" htmlFor="t-built" error={errors.builtArea} hint="Edificados (o del terreno)">
              <Input
                id="t-built"
                inputMode="decimal"
                value={v.builtArea}
                onChange={(e) => set("builtArea", e.target.value)}
              />
            </Field>
            <Field label="Construcción" htmlFor="t-scon" error={errors.subjectConstruction} hint={SCORE_HINT}>
              <ScoreInput
                id="t-scon"
                label="Construcción del bien"
                value={v.subjectConstruction}
                onChange={(x) => set("subjectConstruction", x)}
              />
            </Field>
            <Field label="Ubicación" htmlFor="t-sloc" error={errors.subjectLocation} hint={SCORE_HINT}>
              <ScoreInput
                id="t-sloc"
                label="Ubicación del bien"
                value={v.subjectLocation}
                onChange={(x) => set("subjectLocation", x)}
              />
            </Field>
          </div>

          <details className="group mt-5 rounded-lg border">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium">
              Datos del inmueble (para el informe)
              <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
            </summary>
            <div className="grid gap-4 border-t p-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Título" htmlFor="t-title" className="sm:col-span-2" error={errors.title}>
                <Input
                  id="t-title"
                  value={v.title}
                  placeholder="Ej.: Apartamento 2 dormitorios en Pocitos"
                  onChange={(e) => set("title", e.target.value)}
                />
              </Field>
              <Field label="Cliente / solicitante" htmlFor="t-client" className="sm:col-span-2">
                <Input
                  id="t-client"
                  value={v.clientName}
                  placeholder="Opcional"
                  onChange={(e) => set("clientName", e.target.value)}
                />
              </Field>
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
                  <option value="USD">Dólares (US$)</option>
                  <option value="UYU">Pesos ($)</option>
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
              <Field label="Dirección o referencia" htmlFor="t-addr" className="sm:col-span-2">
                <Input id="t-addr" value={v.address} onChange={(e) => set("address", e.target.value)} />
              </Field>
              <Field label="M² totales / terreno" htmlFor="t-total" error={errors.totalArea}>
                <Input
                  id="t-total"
                  inputMode="decimal"
                  value={v.totalArea}
                  onChange={(e) => set("totalArea", e.target.value)}
                />
              </Field>
              <Field label="Año de construcción" htmlFor="t-year">
                <Input
                  id="t-year"
                  inputMode="numeric"
                  value={v.yearBuilt}
                  onChange={(e) => set("yearBuilt", e.target.value)}
                />
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
              <div className="grid grid-cols-3 gap-2">
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
            </div>
          </details>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button asChild variant="secondary">
              <Link href={comparatorHref}>
                <Search /> Cargar
              </Link>
            </Button>
            <Button type="button" onClick={realize}>
              <Calculator /> Realizar tasación
            </Button>
            <Button type="button" variant="secondary" loading={pending} onClick={() => save("draft")}>
              <Save /> Guardar
            </Button>
          </div>
        </Card>

        {/* ── Resultados ───────────────────────────────────────────── */}
        {showResults && result.count > 0 && (
          <div ref={resultsRef} className="grid scroll-mt-20 gap-6">
            <Card className="p-5">
              <h2 className="mb-4 font-semibold">Resumen</h2>
              <SummaryCards result={result} currency={cur} />
            </Card>

            <Card className="grid gap-5 p-5">
              <h2 className="font-semibold">Proceso de datos</h2>
              <section className="grid gap-3">
                <h3 className="text-sm font-medium">Matriz K</h3>
                <MatrixKTable result={result} />
                {!result.k && (
                  <p className="text-xs text-muted-foreground">
                    Con los antecedentes cargados no se puede ajustar el modelo (faltan antecedentes o las
                    características no varían); se ajusta solo por m².
                  </p>
                )}
                <WarningsBox result={result} />
              </section>
              <section className="grid gap-3">
                <h3 className="text-sm font-medium">Coeficientes de ajuste</h3>
                <CoefficientCards result={result} currency={cur} />
              </section>
              <section className="grid gap-3">
                <h3 className="text-sm font-medium">Valores ajustados</h3>
                <AdjustedBars result={result} currency={cur} />
              </section>
            </Card>

            <Card className="grid gap-4 p-5">
              <h2 className="font-semibold">Conclusión</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Valor adoptado (opcional)"
                  htmlFor="t-adopt"
                  hint="Si tu criterio difiere del valor probable, este es el que figura en el informe."
                >
                  <Input
                    id="t-adopt"
                    inputMode="decimal"
                    value={v.adoptedValue}
                    placeholder={result.probable ? String(Math.round(result.probable)) : ""}
                    onChange={(e) => set("adoptedValue", e.target.value)}
                  />
                </Field>
                <div className="rounded-md bg-surface-muted p-3 text-sm">
                  <p className="text-muted-foreground">Valor del informe</p>
                  <p className="text-xl font-semibold tabular">{fmtMoney(finalValue, cur)}</p>
                </div>
              </div>
              <Field label="Observaciones" htmlFor="t-notes">
                <Textarea
                  id="t-notes"
                  rows={3}
                  value={v.notes}
                  onChange={(e) => set("notes", e.target.value)}
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button type="button" loading={pending} onClick={() => save("final")}>
                  <CheckCircle2 /> Finalizar tasación
                </Button>
                <Button type="button" variant="secondary" disabled={pending} onClick={() => save("draft")}>
                  <Save /> Guardar borrador
                </Button>
                {v.id && canPrint ? (
                  <>
                    <Button asChild variant="secondary">
                      <Link href={`/print/tasacion/${v.id}?interno=1`} target="_blank">
                        <Download /> Descargar informe interno
                      </Link>
                    </Button>
                    <Button asChild variant="secondary">
                      <Link href={`/print/tasacion/${v.id}`} target="_blank">
                        <FileText /> Generar informe
                      </Link>
                    </Button>
                  </>
                ) : (
                  <p className="self-center text-xs text-muted-foreground">
                    Guardá la tasación para generar los informes.
                  </p>
                )}
              </div>
            </Card>
          </div>
        )}
      </div>

      {/* ── Estimación en tiempo real ──────────────────────────────── */}
      <div className="xl:sticky xl:top-20 xl:self-start">
        <Card className="grid gap-4 p-5">
          <div>
            <h2 className="font-semibold">Estimación en tiempo real</h2>
            <p className="text-xs text-muted-foreground">Se recalcula mientras cargás los datos.</p>
          </div>

          <section className="grid gap-2">
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Matriz K</h3>
            <MatrixKTable result={result} compact />
          </section>

          {result.rows.some((r) => r.coefficient !== null) && (
            <section className="grid gap-2">
              <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Coeficientes
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {result.rows
                  .filter((r) => r.coefficient !== null)
                  .map((r) => (
                    <span key={r.index} className="rounded-full border px-2 py-0.5 text-xs tabular">
                      A{r.index + 1}: <span className="font-semibold">{fmtNum(r.coefficient, 4)}</span>
                    </span>
                  ))}
              </div>
            </section>
          )}

          <section className="grid gap-2">
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Rango</h3>
            <div className="grid grid-cols-3 gap-1.5 text-center">
              {(
                [
                  ["Mín.", result.min],
                  ["Probable", result.probable],
                  ["Máx.", result.max],
                ] as const
              ).map(([l, val]) => (
                <div
                  key={l}
                  className={cn(
                    "rounded-md border px-1 py-2",
                    l === "Probable" && "border-primary bg-primary-soft",
                  )}
                >
                  <p className="text-[11px] text-muted-foreground">{l}</p>
                  <p className={cn("text-sm font-semibold tabular", l === "Probable" && "text-primary")}>
                    {fmtMoney(val, cur)}
                  </p>
                </div>
              ))}
            </div>
            {!area && <p className="text-xs text-warning">Cargá los m² del bien problema.</p>}
          </section>

          <section className="grid gap-1.5 text-sm">
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Análisis {unitLabel}
            </h3>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Promedio</span>
              <span className="font-medium tabular">{fmtNum(result.unitAverage, 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Estimado (m² × promedio)</span>
              <span className="tabular">{fmtMoney(result.simpleEstimate, cur)}</span>
            </div>
            {result.rows
              .filter((r) => r.valid)
              .map((r) => (
                <div key={r.index} className="flex justify-between text-xs">
                  <span className="text-muted-foreground">A{r.index + 1}</span>
                  <span className="tabular">{fmtNum(r.unit, 0)}</span>
                </div>
              ))}
          </section>

          <section className="grid grid-cols-2 gap-2 border-t pt-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Incertidumbre</p>
              <p className="font-medium tabular">± {fmtPct(result.uncertainty)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Confianza</p>
              <p className="font-medium tabular">{fmtPct(result.confidence, 0)}</p>
            </div>
          </section>

          {result.warnings.length > 0 && (
            <p className="flex gap-2 rounded-md bg-danger-soft p-2 text-xs text-danger">
              <AlertTriangle className="size-4 shrink-0" />K negativo detectado
              {result.warnings[0]?.cause !== null && result.warnings[0]?.cause !== undefined
                ? ` — revisá A${result.warnings[0].cause + 1}`
                : ""}
            </p>
          )}
          {result.count > 0 && result.count < 4 && (
            <p className="text-xs text-warning">
              Con {result.count} antecedente{result.count > 1 ? "s" : ""} el modelo es limitado: conviene usar
              4 o más.
            </p>
          )}
          {missingScores && result.count > 0 && (
            <p className="text-xs text-muted-foreground">
              Completá construcción y ubicación del bien y de cada antecedente para que entren al cálculo.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
