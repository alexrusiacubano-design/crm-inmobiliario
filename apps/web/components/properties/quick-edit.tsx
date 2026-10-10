"use client";

import {
  ORIENTATION_LABELS,
  ORIENTATIONS,
  PROPERTY_CONDITION_LABELS,
  PROPERTY_CONDITIONS,
  PROPERTY_OPERATION_LABELS,
  PROPERTY_OPERATIONS,
  PROPERTY_TYPE_LABELS,
  PROPERTY_TYPES,
  type Orientation,
  type PropertyCondition,
  type PropertyOperation,
  type PropertyType,
} from "@crm/shared";
import { Pencil, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updatePropertyAction } from "@/app/(app)/properties/actions";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import type { PropertyFormValues } from "./property-form";

/**
 * Datos de la propiedad en el panel lateral, con edición en el mismo lugar. Guarda con el mismo
 * servicio que la edición completa (se envían todos los campos, cambiando solo los editados).
 */
export function PropertyQuickEdit({
  propertyId,
  initial,
  canEdit,
  extraRows,
}: {
  propertyId: string;
  initial: PropertyFormValues;
  canEdit: boolean;
  extraRows: [string, string][];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  const set = <K extends keyof PropertyFormValues>(k: K, value: PropertyFormValues[K]) =>
    setV((p) => ({ ...p, [k]: value }));

  const show = (s: string, suffix = "") => (s ? `${s}${suffix}` : "—");
  const rows: [string, string][] = [
    ["Tipo", PROPERTY_TYPE_LABELS[initial.type]],
    ["Operación", initial.operations.map((o) => PROPERTY_OPERATION_LABELS[o]).join(", ")],
    [
      "Estado inmueble",
      initial.condition ? PROPERTY_CONDITION_LABELS[initial.condition as PropertyCondition] : "—",
    ],
    ["Área edificada", show(initial.builtArea, " m²")],
    ["Área total", show(initial.totalArea, " m²")],
    ["Dormitorios", show(initial.bedrooms)],
    ["Baños", show(initial.bathrooms)],
    ["Garajes", show(initial.garages)],
    ["Piso", show(initial.floor)],
    ["Año construcción", show(initial.yearBuilt)],
    ["Orientación", initial.orientation ? ORIENTATION_LABELS[initial.orientation as Orientation] : "—"],
    ["Padrón", show(initial.padron)],
    ...extraRows,
  ];

  if (!editing)
    return (
      <div>
        <div className="mb-1 flex items-center justify-between">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Datos</p>
          {canEdit && (
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <Pencil /> Editar
            </Button>
          )}
        </div>
        <dl className="divide-y text-sm">
          {rows.map(([k, val]) => (
            <div key={k} className="flex justify-between gap-3 py-1.5">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="text-right">{val}</dd>
            </div>
          ))}
        </dl>
      </div>
    );

  const num = (k: keyof PropertyFormValues, label: string, mode: "numeric" | "decimal" = "numeric") => (
    <Field label={label} htmlFor={`qe-${k}`} error={errors[k]}>
      <Input
        id={`qe-${k}`}
        inputMode={mode}
        value={v[k] as string}
        onChange={(e) => set(k, e.target.value as never)}
      />
    </Field>
  );

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await updatePropertyAction({
            id: propertyId,
            ...v,
            departmentId: v.departmentId || null,
            localityId: v.localityId || null,
            neighborhoodId: v.neighborhoodId || null,
            assignedUserId: null,
          });
          if (!r.ok) {
            setErrors(r.fieldErrors ?? {});
            return void toast.error(r.error);
          }
          setErrors({});
          toast.success("Propiedad actualizada");
          setEditing(false);
          router.refresh();
        });
      }}
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Editar datos</p>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Cancelar"
          onClick={() => {
            setV(initial);
            setErrors({});
            setEditing(false);
          }}
        >
          <X />
        </Button>
      </div>
      <Field label="Título" htmlFor="qe-title" error={errors.title}>
        <Input id="qe-title" value={v.title} onChange={(e) => set("title", e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tipo" htmlFor="qe-type">
          <Select id="qe-type" value={v.type} onChange={(e) => set("type", e.target.value as PropertyType)}>
            {PROPERTY_TYPES.map((t) => (
              <option key={t} value={t}>
                {PROPERTY_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Estado inmueble" htmlFor="qe-cond">
          <Select id="qe-cond" value={v.condition} onChange={(e) => set("condition", e.target.value)}>
            <option value="">—</option>
            {PROPERTY_CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {PROPERTY_CONDITION_LABELS[c]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <fieldset className="grid gap-1.5">
        <legend className="mb-1 text-sm font-medium">Operación</legend>
        <div className="flex flex-wrap gap-1.5">
          {PROPERTY_OPERATIONS.map((o) => {
            const on = v.operations.includes(o);
            return (
              <button
                key={o}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  set(
                    "operations",
                    on ? v.operations.filter((x) => x !== o) : ([...v.operations, o] as PropertyOperation[]),
                  )
                }
                className={cn(
                  "rounded-full border px-3 py-1 text-xs",
                  on ? "border-primary bg-primary-soft text-primary" : "text-muted-foreground",
                )}
              >
                {PROPERTY_OPERATION_LABELS[o]}
              </button>
            );
          })}
        </div>
        {errors.operations && <p className="text-xs text-danger">{errors.operations[0]}</p>}
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        {num("builtArea", "M² edificados", "decimal")}
        {num("totalArea", "M² totales", "decimal")}
        {num("bedrooms", "Dormitorios")}
        {num("bathrooms", "Baños")}
        {num("suites", "Suites")}
        {num("garages", "Garajes")}
        <Field label="Piso" htmlFor="qe-floor" error={errors.floor}>
          <Input id="qe-floor" value={v.floor} onChange={(e) => set("floor", e.target.value)} />
        </Field>
        {num("yearBuilt", "Año construcción")}
        <Field label="Orientación" htmlFor="qe-or">
          <Select id="qe-or" value={v.orientation} onChange={(e) => set("orientation", e.target.value)}>
            <option value="">—</option>
            {ORIENTATIONS.map((o) => (
              <option key={o} value={o}>
                {ORIENTATION_LABELS[o]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Padrón" htmlFor="qe-pad" error={errors.padron}>
          <Input id="qe-pad" value={v.padron} onChange={(e) => set("padron", e.target.value)} />
        </Field>
      </div>
      <Field label="Dirección" htmlFor="qe-addr" error={errors.address}>
        <Input id="qe-addr" value={v.address} onChange={(e) => set("address", e.target.value)} />
      </Field>
      <Field label="Unidad / apto." htmlFor="qe-unit" error={errors.unit}>
        <Input id="qe-unit" value={v.unit} onChange={(e) => set("unit", e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" loading={pending} className="flex-1">
          Guardar cambios
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => {
            setV(initial);
            setErrors({});
            setEditing(false);
          }}
        >
          Cancelar
        </Button>
      </div>
    </form>
  );
}
