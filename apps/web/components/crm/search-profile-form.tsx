"use client";

import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  LEAD_OPERATION_LABELS,
  LEAD_OPERATIONS,
  PROPERTY_FEATURE_LABELS,
  PROPERTY_FEATURES,
  PROPERTY_TYPE_LABELS,
  PROPERTY_TYPES,
  type LeadOperation,
  type PropertyFeature,
  type PropertyType,
} from "@crm/shared/crm";
import { saveSearchProfileAction } from "@/app/(app)/crm/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";

export interface Geo {
  departments: { id: number; name: string }[];
  localities: { id: number; departmentId: number; name: string }[];
  neighborhoods: { id: number; localityId: number; name: string }[];
}

export interface SearchFormValues {
  operation: LeadOperation;
  propertyTypes: PropertyType[];
  departmentIds: number[];
  localityIds: number[];
  neighborhoodIds: number[];
  currency: "USD" | "UYU";
  priceMin: string;
  priceMax: string;
  bedroomsMin: string;
  bathroomsMin: string;
  garagesMin: string;
  areaMin: string;
  commonExpensesMax: string;
  commonExpensesCurrency: "USD" | "UYU";
  pets: boolean;
  furnished: "any" | "yes" | "no";
  features: PropertyFeature[];
  targetDate: string;
  notes: string;
}

function toggle<T>(list: T[], item: T, on: boolean): T[] {
  return on ? [...new Set([...list, item])] : list.filter((x) => x !== item);
}

function Chips<T extends string>({
  options,
  labels,
  value,
  onChange,
}: {
  options: readonly T[];
  labels: Record<T, string>;
  value: T[];
  onChange: (v: T[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button
            key={o}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(toggle(value, o, !on))}
            className={
              on
                ? "rounded-full border border-primary bg-primary-soft px-2.5 py-1 text-xs font-medium text-primary"
                : "rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:bg-surface-muted"
            }
          >
            {labels[o]}
          </button>
        );
      })}
    </div>
  );
}

function SearchForm({
  leadId,
  initial,
  geo,
  onDone,
}: {
  leadId: string;
  initial: SearchFormValues;
  geo: Geo;
  onDone: () => void;
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();
  const [dept, setDept] = useState<number | "">(
    initial.departmentIds[0] ?? geo.departments.find((d) => d.name === "Montevideo")?.id ?? "",
  );
  const set = <K extends keyof SearchFormValues>(k: K, value: SearchFormValues[K]) =>
    setV((prev) => ({ ...prev, [k]: value }));

  const localities = useMemo(
    () => geo.localities.filter((l) => l.departmentId === dept),
    [geo.localities, dept],
  );
  const localityIds = new Set(localities.map((l) => l.id));
  const neighborhoods = geo.neighborhoods.filter((n) => localityIds.has(n.localityId));
  const selectedZones = [
    ...geo.departments
      .filter((d) => v.departmentIds.includes(d.id))
      .map((d) => ({ kind: "departmentIds" as const, id: d.id, name: d.name })),
    ...geo.localities
      .filter((l) => v.localityIds.includes(l.id))
      .map((l) => ({ kind: "localityIds" as const, id: l.id, name: l.name })),
    ...geo.neighborhoods
      .filter((n) => v.neighborhoodIds.includes(n.id))
      .map((n) => ({ kind: "neighborhoodIds" as const, id: n.id, name: n.name })),
  ];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const r = await saveSearchProfileAction({ leadId, search: { ...v, targetDate: v.targetDate || null } });
      if (!r.ok) {
        setErrors(
          Object.fromEntries(
            Object.entries(r.fieldErrors ?? {}).map(([k, m]) => [k.replace(/^search\./, ""), m]),
          ),
        );
        return void toast.error(r.error);
      }
      toast.success("Búsqueda guardada");
      onDone();
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="grid gap-5" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Operación" htmlFor="s-op">
          <Select
            id="s-op"
            value={v.operation}
            onChange={(e) => set("operation", e.target.value as LeadOperation)}
          >
            {LEAD_OPERATIONS.map((o) => (
              <option key={o} value={o}>
                {LEAD_OPERATION_LABELS[o]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Fecha estimada de mudanza o compra" htmlFor="s-date" error={errors.targetDate}>
          <Input
            id="s-date"
            type="date"
            value={v.targetDate}
            onChange={(e) => set("targetDate", e.target.value)}
          />
        </Field>
      </div>

      <Field label="Tipo de inmueble">
        <Chips
          options={PROPERTY_TYPES}
          labels={PROPERTY_TYPE_LABELS}
          value={v.propertyTypes}
          onChange={(x) => set("propertyTypes", x)}
        />
      </Field>

      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">Zonas</legend>
        {selectedZones.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {selectedZones.map((z) => (
              <button
                key={`${z.kind}-${z.id}`}
                type="button"
                onClick={() =>
                  set(
                    z.kind,
                    (v[z.kind] as number[]).filter((x) => x !== z.id),
                  )
                }
                className="rounded-full bg-primary-soft px-2.5 py-1 text-xs font-medium text-primary"
                aria-label={`Quitar ${z.name}`}
              >
                {z.name} ×
              </button>
            ))}
          </div>
        )}
        <div className="grid gap-2 rounded-md border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label="Departamento"
              value={dept}
              onChange={(e) => setDept(e.target.value ? Number(e.target.value) : "")}
              className="h-8 w-48 text-sm"
            >
              {geo.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
            {dept !== "" && (
              <label className="flex items-center gap-1.5 text-xs">
                <Checkbox
                  checked={v.departmentIds.includes(dept)}
                  onChange={(e) => set("departmentIds", toggle(v.departmentIds, dept, e.target.checked))}
                />
                Todo el departamento
              </label>
            )}
          </div>
          {localities.length > 1 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {localities.map((l) => (
                <label key={l.id} className="flex items-center gap-1.5 text-xs">
                  <Checkbox
                    checked={v.localityIds.includes(l.id)}
                    onChange={(e) => set("localityIds", toggle(v.localityIds, l.id, e.target.checked))}
                  />
                  {l.name}
                </label>
              ))}
            </div>
          )}
          {neighborhoods.length > 0 && (
            <div className="grid max-h-36 grid-cols-2 gap-x-4 gap-y-1 overflow-y-auto sm:grid-cols-3">
              {neighborhoods.map((n) => (
                <label key={n.id} className="flex items-center gap-1.5 text-xs">
                  <Checkbox
                    checked={v.neighborhoodIds.includes(n.id)}
                    onChange={(e) =>
                      set("neighborhoodIds", toggle(v.neighborhoodIds, n.id, e.target.checked))
                    }
                  />
                  {n.name}
                </label>
              ))}
            </div>
          )}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-[8rem_1fr_1fr]">
        <Field label="Moneda" htmlFor="s-cur">
          <Select
            id="s-cur"
            value={v.currency}
            onChange={(e) => set("currency", e.target.value as "USD" | "UYU")}
          >
            <option value="USD">U$S</option>
            <option value="UYU">$</option>
          </Select>
        </Field>
        <Field label="Precio mínimo" htmlFor="s-min" error={errors.priceMin}>
          <Input
            id="s-min"
            inputMode="decimal"
            value={v.priceMin}
            onChange={(e) => set("priceMin", e.target.value)}
            placeholder="180.000"
          />
        </Field>
        <Field label="Precio máximo" htmlFor="s-max" error={errors.priceMax}>
          <Input
            id="s-max"
            inputMode="decimal"
            value={v.priceMax}
            onChange={(e) => set("priceMax", e.target.value)}
            placeholder="230.000"
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {(
          [
            ["bedroomsMin", "Dormitorios mín."],
            ["bathroomsMin", "Baños mín."],
            ["garagesMin", "Garajes mín."],
            ["areaMin", "Superficie mín. (m²)"],
          ] as const
        ).map(([k, label]) => (
          <Field key={k} label={label} htmlFor={`s-${k}`} error={errors[k]}>
            <Input
              id={`s-${k}`}
              inputMode="numeric"
              value={v[k]}
              onChange={(e) => set(k, e.target.value.replace(/\D/g, ""))}
            />
          </Field>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_8rem_1fr]">
        <Field label="Gastos comunes máximos" htmlFor="s-gc" error={errors.commonExpensesMax}>
          <Input
            id="s-gc"
            inputMode="decimal"
            value={v.commonExpensesMax}
            onChange={(e) => set("commonExpensesMax", e.target.value)}
          />
        </Field>
        <Field label="Moneda GC" htmlFor="s-gc-cur">
          <Select
            id="s-gc-cur"
            value={v.commonExpensesCurrency}
            onChange={(e) => set("commonExpensesCurrency", e.target.value as "USD" | "UYU")}
          >
            <option value="UYU">$</option>
            <option value="USD">U$S</option>
          </Select>
        </Field>
        <Field label="Amueblado" htmlFor="s-furn">
          <Select
            id="s-furn"
            value={v.furnished}
            onChange={(e) => set("furnished", e.target.value as SearchFormValues["furnished"])}
          >
            <option value="any">Indistinto</option>
            <option value="yes">Sí</option>
            <option value="no">No</option>
          </Select>
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={v.pets} onChange={(e) => set("pets", e.target.checked)} /> Necesita que acepten
        mascotas
      </label>

      <Field label="Características deseadas">
        <Chips
          options={PROPERTY_FEATURES}
          labels={PROPERTY_FEATURE_LABELS}
          value={v.features}
          onChange={(x) => set("features", x)}
        />
      </Field>

      <Field label="Notas de la búsqueda" htmlFor="s-notes">
        <Textarea id="s-notes" rows={2} value={v.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>

      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onDone} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" loading={pending}>
          Guardar búsqueda
        </Button>
      </DialogFooter>
    </form>
  );
}

export function EditSearchButton({
  leadId,
  initial,
  geo,
}: {
  leadId: string;
  initial: SearchFormValues;
  geo: Geo;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Pencil /> Editar
      </Button>
      <DialogContent
        title="Qué busca"
        description="Estos criterios usa el matching (Fase 4) para sugerir propiedades."
        className="max-w-3xl"
      >
        {open && <SearchForm leadId={leadId} initial={initial} geo={geo} onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}
