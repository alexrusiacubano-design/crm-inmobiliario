"use client";

import { Pencil, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { PROPERTY_TYPE_LABELS, PROPERTY_TYPES, type PropertyType } from "@crm/shared/crm";
import { PROPERTY_OPERATION_LABELS, PROPERTY_OPERATIONS, type PropertyOperation } from "@crm/shared/property";
import { PORTAL_LABELS, PORTALS } from "@crm/shared/publications";
import { createAcquisitionAction, updateAcquisitionAction } from "@/app/(app)/properties/actions";
import { ContactPicker } from "@/components/crm/lead-dialog";
import type { Geo } from "@/components/crm/search-profile-form";
import { MapPicker } from "@/components/properties/map-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";

export interface AcquisitionFormValues {
  owner: { id: string; displayName: string } | null;
  propertyType: PropertyType;
  operation: PropertyOperation;
  departmentId: string;
  localityId: string;
  neighborhoodId: string;
  address: string;
  padron: string;
  latitude: string;
  longitude: string;
  sourcePortal: string;
  portalUrl: string;
  exclusive: boolean;
  exclusiveFrom: string;
  exclusiveUntil: string;
  commissionPercent: string;
  currency: "USD" | "UYU";
  askingPrice: string;
  recommendedPrice: string;
  publicationAuthorized: boolean;
  captadorUserId: string;
  notes: string;
}

function AcquisitionForm({
  acquisitionId,
  initial,
  geo,
  assignees,
  onDone,
}: {
  acquisitionId?: string;
  initial: AcquisitionFormValues;
  geo: Geo;
  assignees?: { userId: string; name: string }[];
  onDone: (id: string) => void;
}) {
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof AcquisitionFormValues>(k: K, value: AcquisitionFormValues[K]) =>
    setV((p) => ({ ...p, [k]: value }));
  const localities = useMemo(
    () => geo.localities.filter((l) => String(l.departmentId) === v.departmentId),
    [geo.localities, v.departmentId],
  );
  const neighborhoods = useMemo(
    () => geo.neighborhoods.filter((n) => String(n.localityId) === v.localityId),
    [geo.neighborhoods, v.localityId],
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!v.owner) return void setErrors({ ownerContactId: ["Elegí el propietario"] });
    startTransition(async () => {
      const { owner, departmentId: _d, ...rest } = v;
      const payload = {
        ...rest,
        ownerContactId: owner?.id,
        localityId: v.localityId || null,
        neighborhoodId: v.neighborhoodId || null,
        captadorUserId: v.captadorUserId || null,
        sourcePortal: v.sourcePortal || null,
        exclusiveFrom: v.exclusive ? v.exclusiveFrom || null : null,
        exclusiveUntil: v.exclusive ? v.exclusiveUntil || null : null,
      };
      const r = acquisitionId
        ? await updateAcquisitionAction({ id: acquisitionId, ...payload })
        : await createAcquisitionAction(payload);
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        return void toast.error(r.error);
      }
      toast.success(acquisitionId ? "Captación actualizada" : "Captación creada");
      onDone(acquisitionId ?? (r.data as { id: string } | undefined)?.id ?? "");
    });
  };

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <Field label="Propietario" error={errors.ownerContactId}>
        {v.owner ? (
          <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
            <span className="font-medium">{v.owner.displayName}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Cambiar propietario"
              onClick={() => set("owner", null)}
            >
              <X />
            </Button>
          </div>
        ) : (
          <ContactPicker onPick={(c) => set("owner", { id: c.id, displayName: c.displayName })} />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tipo" htmlFor="a-type">
          <Select
            id="a-type"
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
        <Field label="Operación" htmlFor="a-op">
          <Select
            id="a-op"
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
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Departamento" htmlFor="a-dept">
          <Select
            id="a-dept"
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
        <Field label="Localidad" htmlFor="a-loc" error={errors.localityId}>
          <Select
            id="a-loc"
            value={v.localityId}
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
        <Field label="Barrio" htmlFor="a-nb">
          <Select
            id="a-nb"
            value={v.neighborhoodId}
            disabled={neighborhoods.length === 0}
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
      </div>
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <Field label="Dirección" htmlFor="a-addr">
          <Input id="a-addr" value={v.address} onChange={(e) => set("address", e.target.value)} />
        </Field>
        <Field label="Padrón" htmlFor="a-padron" error={errors.padron}>
          <Input id="a-padron" value={v.padron} onChange={(e) => set("padron", e.target.value)} />
        </Field>
      </div>
      <MapPicker
        latitude={v.latitude}
        longitude={v.longitude}
        onChange={(latitude, longitude) => setV((p) => ({ ...p, latitude, longitude }))}
      />
      <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
        <Field label="¿La viste publicada en un portal?" htmlFor="a-src">
          <Select id="a-src" value={v.sourcePortal} onChange={(e) => set("sourcePortal", e.target.value)}>
            <option value="">No / captación directa</option>
            {PORTALS.filter((x) => x !== "website").map((x) => (
              <option key={x} value={x}>
                {PORTAL_LABELS[x]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Enlace del aviso" htmlFor="a-url" error={errors.portalUrl}>
          <Input
            id="a-url"
            type="url"
            placeholder="https://"
            value={v.portalUrl}
            onChange={(e) => set("portalUrl", e.target.value)}
          />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="Moneda" htmlFor="a-cur">
          <Select
            id="a-cur"
            value={v.currency}
            onChange={(e) => set("currency", e.target.value as "USD" | "UYU")}
          >
            <option value="USD">U$S</option>
            <option value="UYU">$ (UYU)</option>
          </Select>
        </Field>
        <Field label="Pide el propietario" htmlFor="a-ask" error={errors.askingPrice}>
          <Input
            id="a-ask"
            inputMode="decimal"
            value={v.askingPrice}
            onChange={(e) => set("askingPrice", e.target.value)}
          />
        </Field>
        <Field label="Precio recomendado" htmlFor="a-rec" error={errors.recommendedPrice}>
          <Input
            id="a-rec"
            inputMode="decimal"
            value={v.recommendedPrice}
            onChange={(e) => set("recommendedPrice", e.target.value)}
          />
        </Field>
        <Field label="Comisión (%)" htmlFor="a-com" error={errors.commissionPercent}>
          <Input
            id="a-com"
            inputMode="decimal"
            value={v.commissionPercent}
            onChange={(e) => set("commissionPercent", e.target.value)}
          />
        </Field>
      </div>
      <div className="grid gap-3 rounded-md border p-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Checkbox checked={v.exclusive} onChange={(e) => set("exclusive", e.target.checked)} /> Exclusividad
        </label>
        {v.exclusive && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Desde" htmlFor="a-exf" error={errors.exclusiveFrom}>
              <Input
                id="a-exf"
                type="date"
                value={v.exclusiveFrom}
                onChange={(e) => set("exclusiveFrom", e.target.value)}
              />
            </Field>
            <Field label="Vence" htmlFor="a-exu" error={errors.exclusiveUntil}>
              <Input
                id="a-exu"
                type="date"
                value={v.exclusiveUntil}
                onChange={(e) => set("exclusiveUntil", e.target.value)}
              />
            </Field>
          </div>
        )}
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            className="mt-0.5"
            checked={v.publicationAuthorized}
            onChange={(e) => set("publicationAuthorized", e.target.checked)}
          />
          <span>
            El propietario firmó la autorización de publicación
            <span className="block text-xs text-muted-foreground">
              Requisito para pasar a “Captado”. Cargá el documento firmado en la ficha de la propiedad.
            </span>
          </span>
        </label>
      </div>
      {assignees && assignees.length > 0 && (
        <Field label="Captador" htmlFor="a-cap" error={errors.captadorUserId}>
          <Select id="a-cap" value={v.captadorUserId} onChange={(e) => set("captadorUserId", e.target.value)}>
            <option value="">{acquisitionId ? "Sin cambios" : "Yo"}</option>
            {assignees.map((a) => (
              <option key={a.userId} value={a.userId}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Notas" htmlFor="a-notes">
        <Textarea id="a-notes" rows={3} value={v.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>
      <DialogFooter>
        <Button type="submit" loading={pending}>
          {acquisitionId ? "Guardar" : "Crear captación"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function AcquisitionDialogButton({
  acquisitionId,
  initial,
  geo,
  assignees,
}: {
  acquisitionId?: string;
  initial: AcquisitionFormValues;
  geo: Geo;
  assignees?: { userId: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        size="sm"
        variant={acquisitionId ? "secondary" : "primary"}
        onClick={() => {
          setKey((k) => k + 1);
          setOpen(true);
        }}
      >
        {acquisitionId ? <Pencil /> : <Plus />}
        {acquisitionId ? "Editar" : "Nueva captación"}
      </Button>
      <DialogContent
        title={acquisitionId ? "Editar captación" : "Nueva captación"}
        description="Seguimiento de un propietario que evalúa dejarnos su propiedad."
        className="max-w-2xl"
      >
        <AcquisitionForm
          key={key}
          acquisitionId={acquisitionId}
          initial={initial}
          geo={geo}
          assignees={assignees}
          onDone={(id) => {
            setOpen(false);
            if (!acquisitionId && id) router.push(`/properties/acquisitions/${id}`);
            router.refresh();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
