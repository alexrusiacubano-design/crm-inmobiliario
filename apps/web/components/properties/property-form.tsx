"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { MapPicker } from "@/components/properties/map-picker";
import {
  PROPERTY_FEATURE_LABELS,
  PROPERTY_FEATURES,
  PROPERTY_TYPE_LABELS,
  PROPERTY_TYPES,
  type PropertyFeature,
  type PropertyType,
} from "@crm/shared/crm";
import {
  EXPENSE_KIND_LABELS,
  EXPENSE_KINDS,
  EXPENSE_PERIOD_LABELS,
  EXPENSE_PERIODS,
  ORIENTATION_LABELS,
  ORIENTATIONS,
  PROPERTY_CONDITION_LABELS,
  PROPERTY_CONDITIONS,
  PROPERTY_OPERATION_LABELS,
  PROPERTY_OPERATIONS,
  type ExpenseKind,
  type ExpensePeriod,
  type PropertyOperation,
} from "@crm/shared/property";
import { createPropertyAction, updatePropertyAction } from "@/app/(app)/properties/actions";
import type { Geo } from "@/components/crm/search-profile-form";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { Card } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

export interface ExpenseValues {
  kind: ExpenseKind;
  label: string;
  amount: string;
  currency: "UYU" | "USD";
  period: ExpensePeriod;
}

export interface PropertyFormValues {
  type: PropertyType;
  operations: PropertyOperation[];
  title: string;
  description: string;
  departmentId: string;
  localityId: string;
  neighborhoodId: string;
  address: string;
  unit: string;
  padron: string;
  latitude: string;
  longitude: string;
  bedrooms: string;
  bathrooms: string;
  suites: string;
  garages: string;
  totalArea: string;
  builtArea: string;
  floor: string;
  yearBuilt: string;
  orientation: string;
  condition: string;
  features: PropertyFeature[];
  petsAllowed: boolean;
  furnished: boolean;
  commissionPercent: string;
  assignedUserId: string;
  internalNotes: string;
  expenses: ExpenseValues[];
}

function Chips<T extends string>({
  options,
  labels,
  value,
  onChange,
  label,
}: {
  options: readonly T[];
  labels: Record<T, string>;
  value: T[];
  onChange: (v: T[]) => void;
  label: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button
            key={o}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs",
              on
                ? "border-primary bg-primary-soft font-medium text-primary"
                : "text-muted-foreground hover:bg-surface-muted",
            )}
          >
            {labels[o]}
          </button>
        );
      })}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <h2 className="border-b px-4 py-3 text-sm font-semibold">{title}</h2>
      <div className="grid gap-4 p-4">{children}</div>
    </Card>
  );
}

export function PropertyForm({
  propertyId,
  initial,
  geo,
  assignees,
}: {
  propertyId?: string;
  initial: PropertyFormValues;
  geo: Geo;
  assignees?: { userId: string; name: string }[];
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof PropertyFormValues>(k: K, value: PropertyFormValues[K]) =>
    setV((prev) => ({ ...prev, [k]: value }));

  const localities = useMemo(
    () => geo.localities.filter((l) => String(l.departmentId) === v.departmentId),
    [geo.localities, v.departmentId],
  );
  const neighborhoods = useMemo(
    () => geo.neighborhoods.filter((n) => String(n.localityId) === v.localityId),
    [geo.neighborhoods, v.localityId],
  );
  const err = (k: string) => errors[k];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const payload = {
        ...v,
        departmentId: v.departmentId || null,
        localityId: v.localityId || null,
        neighborhoodId: v.neighborhoodId || null,
        assignedUserId: v.assignedUserId || null,
      };
      const r = propertyId
        ? await updatePropertyAction({ id: propertyId, ...payload })
        : await createPropertyAction(payload);
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        return void toast.error(r.error);
      }
      toast.success(propertyId ? "Propiedad actualizada" : "Propiedad creada en borrador");
      router.push(`/properties/${r.data.id}`);
      router.refresh();
    });
  };

  const intField = (k: keyof PropertyFormValues, label: string, max = 50) => (
    <Field label={label} htmlFor={`p-${k}`} error={err(k)}>
      <Input
        id={`p-${k}`}
        inputMode="numeric"
        type="number"
        min={0}
        max={max}
        value={v[k] as string}
        onChange={(e) => set(k, e.target.value as never)}
      />
    </Field>
  );

  return (
    <form onSubmit={submit} className="grid gap-5" noValidate>
      <Section title="Operación y tipo">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tipo de inmueble" htmlFor="p-type" error={err("type")}>
            <Select id="p-type" value={v.type} onChange={(e) => set("type", e.target.value as PropertyType)}>
              {PROPERTY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {PROPERTY_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Operaciones" error={err("operations")}>
            <Chips
              label="Operaciones"
              options={PROPERTY_OPERATIONS}
              labels={PROPERTY_OPERATION_LABELS}
              value={v.operations}
              onChange={(ops) => set("operations", ops)}
            />
          </Field>
        </div>
        <Field
          label="Título"
          htmlFor="p-title"
          error={err("title")}
          hint="Lo verán los clientes cuando se publique. Mínimo 8 caracteres para publicar."
        >
          <Input
            id="p-title"
            maxLength={140}
            value={v.title}
            onChange={(e) => set("title", e.target.value)}
          />
        </Field>
        <Field
          label="Descripción"
          htmlFor="p-desc"
          error={err("description")}
          hint="Mínimo 40 caracteres para publicar."
        >
          <Textarea
            id="p-desc"
            rows={5}
            maxLength={8000}
            value={v.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </Field>
      </Section>

      <Section title="Ubicación">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Departamento" htmlFor="p-dept" error={err("departmentId")}>
            <Select
              id="p-dept"
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
          <Field label="Localidad" htmlFor="p-loc" error={err("localityId")}>
            <Select
              id="p-loc"
              value={v.localityId}
              disabled={!v.departmentId}
              onChange={(e) => setV((p) => ({ ...p, localityId: e.target.value, neighborhoodId: "" }))}
            >
              <option value="">Elegí…</option>
              {localities.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Barrio" htmlFor="p-nb" error={err("neighborhoodId")}>
            <Select
              id="p-nb"
              value={v.neighborhoodId}
              disabled={neighborhoods.length === 0}
              onChange={(e) => set("neighborhoodId", e.target.value)}
            >
              <option value="">{neighborhoods.length ? "Elegí…" : "Sin barrios cargados"}</option>
              {neighborhoods.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
          <Field
            label="Dirección"
            htmlFor="p-addr"
            error={err("address")}
            hint="Uso interno; no se publica exacta."
          >
            <Input id="p-addr" value={v.address} onChange={(e) => set("address", e.target.value)} />
          </Field>
          <Field label="Unidad / apto." htmlFor="p-unit" error={err("unit")}>
            <Input id="p-unit" value={v.unit} onChange={(e) => set("unit", e.target.value)} />
          </Field>
          <Field label="Padrón" htmlFor="p-padron" error={err("padron")} hint="Número de padrón catastral.">
            <Input id="p-padron" value={v.padron} onChange={(e) => set("padron", e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-2">
          <span className="text-sm font-medium">Ubicación en el mapa</span>
          <MapPicker
            latitude={v.latitude}
            longitude={v.longitude}
            onChange={(latitude, longitude) => setV((p) => ({ ...p, latitude, longitude }))}
          />
          {(err("latitude") || err("longitude")) && (
            <p className="text-xs text-danger">{(err("latitude") ?? err("longitude"))?.[0]}</p>
          )}
        </div>
      </Section>

      <Section title="Características">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {intField("bedrooms", "Dormitorios")}
          {intField("bathrooms", "Baños")}
          {intField("suites", "Suites")}
          {intField("garages", "Garajes")}
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="Sup. total (m²)" htmlFor="p-ta" error={err("totalArea")}>
            <Input
              id="p-ta"
              inputMode="decimal"
              value={v.totalArea}
              onChange={(e) => set("totalArea", e.target.value)}
            />
          </Field>
          <Field label="Sup. edificada (m²)" htmlFor="p-ba" error={err("builtArea")}>
            <Input
              id="p-ba"
              inputMode="decimal"
              value={v.builtArea}
              onChange={(e) => set("builtArea", e.target.value)}
            />
          </Field>
          <Field label="Piso" htmlFor="p-floor" error={err("floor")}>
            <Input id="p-floor" value={v.floor} onChange={(e) => set("floor", e.target.value)} />
          </Field>
          {intField("yearBuilt", "Año de construcción", 2100)}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Orientación" htmlFor="p-or" error={err("orientation")}>
            <Select id="p-or" value={v.orientation} onChange={(e) => set("orientation", e.target.value)}>
              <option value="">Sin indicar</option>
              {ORIENTATIONS.map((o) => (
                <option key={o} value={o}>
                  {ORIENTATION_LABELS[o]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Estado" htmlFor="p-cond" error={err("condition")}>
            <Select id="p-cond" value={v.condition} onChange={(e) => set("condition", e.target.value)}>
              <option value="">Sin indicar</option>
              {PROPERTY_CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {PROPERTY_CONDITION_LABELS[c]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Comodidades" error={err("features")}>
          <Chips
            label="Comodidades"
            options={PROPERTY_FEATURES}
            labels={PROPERTY_FEATURE_LABELS}
            value={v.features}
            onChange={(f) => set("features", f)}
          />
        </Field>
        <div className="flex flex-wrap gap-6 text-sm">
          <label className="flex items-center gap-2">
            <Checkbox checked={v.petsAllowed} onChange={(e) => set("petsAllowed", e.target.checked)} /> Acepta
            mascotas
          </label>
          <label className="flex items-center gap-2">
            <Checkbox checked={v.furnished} onChange={(e) => set("furnished", e.target.checked)} /> Amueblada
          </label>
        </div>
      </Section>

      <Section title="Gastos">
        {v.expenses.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Sin gastos cargados (gastos comunes, contribución, primaria…).
          </p>
        )}
        {v.expenses.map((ex, i) => {
          const update = (patch: Partial<ExpenseValues>) =>
            set(
              "expenses",
              v.expenses.map((x, j) => (j === i ? { ...x, ...patch } : x)),
            );
          return (
            <div key={i} className="grid items-end gap-2 sm:grid-cols-[1.3fr_1fr_1fr_0.7fr_1fr_auto]">
              <Field label="Concepto" htmlFor={`ex-k-${i}`}>
                <Select
                  id={`ex-k-${i}`}
                  value={ex.kind}
                  onChange={(e) => update({ kind: e.target.value as ExpenseKind })}
                >
                  {EXPENSE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {EXPENSE_KIND_LABELS[k]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Detalle" htmlFor={`ex-l-${i}`}>
                <Input
                  id={`ex-l-${i}`}
                  value={ex.label}
                  onChange={(e) => update({ label: e.target.value })}
                />
              </Field>
              <Field label="Importe" htmlFor={`ex-a-${i}`} error={err(`expenses.${i}.amount`)}>
                <Input
                  id={`ex-a-${i}`}
                  inputMode="decimal"
                  value={ex.amount}
                  onChange={(e) => update({ amount: e.target.value })}
                />
              </Field>
              <Field label="Moneda" htmlFor={`ex-c-${i}`}>
                <Select
                  id={`ex-c-${i}`}
                  value={ex.currency}
                  onChange={(e) => update({ currency: e.target.value as "UYU" | "USD" })}
                >
                  <option value="UYU">$</option>
                  <option value="USD">U$S</option>
                </Select>
              </Field>
              <Field label="Período" htmlFor={`ex-p-${i}`}>
                <Select
                  id={`ex-p-${i}`}
                  value={ex.period}
                  onChange={(e) => update({ period: e.target.value as ExpensePeriod })}
                >
                  {EXPENSE_PERIODS.map((p) => (
                    <option key={p} value={p}>
                      {EXPENSE_PERIOD_LABELS[p]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Quitar gasto"
                onClick={() =>
                  set(
                    "expenses",
                    v.expenses.filter((_, j) => j !== i),
                  )
                }
              >
                <Trash2 />
              </Button>
            </div>
          );
        })}
        {v.expenses.length < 10 && (
          <div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() =>
                set("expenses", [
                  ...v.expenses,
                  { kind: "common_expenses", label: "", amount: "", currency: "UYU", period: "monthly" },
                ])
              }
            >
              <Plus /> Agregar gasto
            </Button>
          </div>
        )}
      </Section>

      <Section title="Gestión interna">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Comisión (%)"
            htmlFor="p-com"
            error={err("commissionPercent")}
            hint="Acordada con el propietario, ej.: 3 o 3,5"
          >
            <Input
              id="p-com"
              inputMode="decimal"
              value={v.commissionPercent}
              onChange={(e) => set("commissionPercent", e.target.value)}
            />
          </Field>
          {assignees && assignees.length > 0 && (
            <Field label="Responsable" htmlFor="p-resp" error={err("assignedUserId")}>
              <Select
                id="p-resp"
                value={v.assignedUserId}
                onChange={(e) => set("assignedUserId", e.target.value)}
              >
                <option value="">{propertyId ? "Sin cambios" : "Yo"}</option>
                {assignees.map((a) => (
                  <option key={a.userId} value={a.userId}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        <Field label="Notas internas" htmlFor="p-notes" error={err("internalNotes")} hint="No se publican.">
          <Textarea
            id="p-notes"
            rows={3}
            value={v.internalNotes}
            onChange={(e) => set("internalNotes", e.target.value)}
          />
        </Field>
      </Section>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => router.back()} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" loading={pending}>
          {propertyId ? "Guardar cambios" : "Crear propiedad"}
        </Button>
      </div>
    </form>
  );
}
