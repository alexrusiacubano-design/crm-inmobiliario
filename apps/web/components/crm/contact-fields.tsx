"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  CHANNEL_TYPE_LABELS,
  CHANNEL_TYPES,
  DOCUMENT_TYPE_LABELS,
  DOCUMENT_TYPES,
  type ChannelType,
  type ContactKind,
  type DocumentType,
} from "@crm/shared/crm";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { cn } from "@/lib/utils";

export interface ContactFormValues {
  kind: ContactKind;
  firstName: string;
  lastName: string;
  companyName: string;
  documentType: DocumentType | "";
  documentNumber: string;
  nationality: string;
  address: string;
  notes: string;
  assignedUserId: string;
  tags: string;
  channels: { type: ChannelType; value: string; isPrimary: boolean }[];
}

export const emptyContact: ContactFormValues = {
  kind: "person",
  firstName: "",
  lastName: "",
  companyName: "",
  documentType: "",
  documentNumber: "",
  nationality: "",
  address: "",
  notes: "",
  assignedUserId: "",
  tags: "",
  channels: [{ type: "phone", value: "", isPrimary: true }],
};

/** Convierte el estado del formulario al payload que valida el servidor. */
export function toContactPayload(v: ContactFormValues) {
  return {
    kind: v.kind,
    firstName: v.firstName,
    lastName: v.lastName,
    companyName: v.companyName,
    documentType: v.documentType || null,
    documentNumber: v.documentNumber,
    nationality: v.nationality,
    address: v.address,
    notes: v.notes,
    assignedUserId: v.assignedUserId || null,
    tags: v.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    channels: v.channels.filter((c) => c.value.trim()),
  };
}

export function ContactFields({
  value,
  onChange,
  errors,
  assignees,
  compact = false,
}: {
  value: ContactFormValues;
  onChange: (v: ContactFormValues) => void;
  errors: Record<string, string[]>;
  assignees?: { userId: string; name: string }[];
  compact?: boolean;
}) {
  const set = <K extends keyof ContactFormValues>(key: K, v: ContactFormValues[K]) =>
    onChange({ ...value, [key]: v });
  const setChannel = (i: number, patch: Partial<ContactFormValues["channels"][number]>) =>
    set(
      "channels",
      value.channels.map((c, idx) => (idx === i ? { ...c, ...patch } : c)),
    );
  const channelError = (i: number) => errors[`channels.${i}.value`] ?? errors[`contact.channels.${i}.value`];
  const err = (k: string) => errors[k] ?? errors[`contact.${k}`];
  const [showMore, setShowMore] = useState(!compact);

  return (
    <div className="grid gap-4">
      <div
        className="inline-flex w-fit rounded-md border p-0.5 text-sm"
        role="radiogroup"
        aria-label="Tipo de contacto"
      >
        {(["person", "company"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={value.kind === k}
            onClick={() => set("kind", k)}
            className={cn(
              "rounded px-3 py-1",
              value.kind === k ? "bg-primary-soft font-medium text-primary" : "text-muted-foreground",
            )}
          >
            {k === "person" ? "Persona" : "Empresa"}
          </button>
        ))}
      </div>

      {value.kind === "person" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre" htmlFor="c-first" error={err("firstName")}>
            <Input
              id="c-first"
              value={value.firstName}
              onChange={(e) => set("firstName", e.target.value)}
              aria-invalid={!!err("firstName")}
            />
          </Field>
          <Field label="Apellido" htmlFor="c-last" error={err("lastName")}>
            <Input id="c-last" value={value.lastName} onChange={(e) => set("lastName", e.target.value)} />
          </Field>
        </div>
      ) : (
        <Field label="Razón social" htmlFor="c-company" error={err("companyName")}>
          <Input
            id="c-company"
            value={value.companyName}
            onChange={(e) => set("companyName", e.target.value)}
            aria-invalid={!!err("companyName")}
          />
        </Field>
      )}

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Teléfonos y emails</legend>
        {value.channels.map((c, i) => (
          <div key={i} className="grid gap-1">
            <div className="flex gap-2">
              <select
                aria-label="Tipo"
                value={c.type}
                onChange={(e) => setChannel(i, { type: e.target.value as ChannelType })}
                className="h-9 w-32 shrink-0 rounded-md border border-border-strong bg-surface px-2 text-sm"
              >
                {CHANNEL_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {CHANNEL_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
              <Input
                aria-label={`${CHANNEL_TYPE_LABELS[c.type]} ${i + 1}`}
                value={c.value}
                onChange={(e) => setChannel(i, { value: e.target.value })}
                placeholder={c.type === "email" ? "nombre@dominio.com" : "099 123 456"}
                type={c.type === "email" ? "email" : "tel"}
                aria-invalid={!!channelError(i)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Quitar"
                onClick={() =>
                  set(
                    "channels",
                    value.channels.filter((_, idx) => idx !== i),
                  )
                }
              >
                <Trash2 />
              </Button>
            </div>
            {channelError(i) && <p className="text-xs text-danger">{channelError(i)?.[0]}</p>}
          </div>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-fit"
          onClick={() => set("channels", [...value.channels, { type: "phone", value: "", isPrimary: false }])}
        >
          <Plus /> Agregar teléfono o email
        </Button>
      </fieldset>

      {assignees && assignees.length > 0 && (
        <Field label="Agente responsable" htmlFor="c-assignee" error={err("assignedUserId")}>
          <Select
            id="c-assignee"
            value={value.assignedUserId}
            onChange={(e) => set("assignedUserId", e.target.value)}
          >
            <option value="">Yo</option>
            {assignees.map((a) => (
              <option key={a.userId} value={a.userId}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {compact && !showMore ? (
        <Button type="button" variant="link" className="w-fit" onClick={() => setShowMore(true)}>
          Agregar documento, dirección y notas
        </Button>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
            <Field label="Documento" htmlFor="c-doctype" error={err("documentType")}>
              <Select
                id="c-doctype"
                value={value.documentType}
                onChange={(e) => set("documentType", e.target.value as DocumentType | "")}
              >
                <option value="">Sin documento</option>
                {DOCUMENT_TYPES.map((d) => (
                  <option key={d} value={d}>
                    {DOCUMENT_TYPE_LABELS[d]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Número"
              htmlFor="c-docnum"
              error={err("documentNumber")}
              hint={
                value.documentType === "ci" ? "Ej.: 1.234.567-2 (se valida el dígito verificador)" : undefined
              }
            >
              <Input
                id="c-docnum"
                value={value.documentNumber}
                onChange={(e) => set("documentNumber", e.target.value)}
                disabled={!value.documentType}
                aria-invalid={!!err("documentNumber")}
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nacionalidad" htmlFor="c-nat">
              <Input
                id="c-nat"
                value={value.nationality}
                onChange={(e) => set("nationality", e.target.value)}
              />
            </Field>
            <Field label="Etiquetas" htmlFor="c-tags" hint="Separadas por comas">
              <Input
                id="c-tags"
                value={value.tags}
                onChange={(e) => set("tags", e.target.value)}
                placeholder="Inversor, VIP"
              />
            </Field>
          </div>
          <Field label="Dirección" htmlFor="c-address">
            <Input id="c-address" value={value.address} onChange={(e) => set("address", e.target.value)} />
          </Field>
          <Field label="Notas" htmlFor="c-notes">
            <Textarea
              id="c-notes"
              rows={3}
              value={value.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </Field>
        </>
      )}
    </div>
  );
}
