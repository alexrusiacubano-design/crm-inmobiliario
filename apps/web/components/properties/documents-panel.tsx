"use client";

import { Download, FileText, Lock, Pencil, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_CATEGORY_LABELS,
  DOCUMENT_STATUS_LABELS,
  DOCUMENT_STATUSES,
  DOCUMENT_VISIBILITIES,
  DOCUMENT_VISIBILITY_LABELS,
  SUGGESTED_DOCUMENT_TYPES,
  type DocumentCategory,
  type DocumentStatus,
  type DocumentVisibility,
} from "@crm/shared/property";
import { deleteDocumentAction, updateDocumentAction } from "@/app/(app)/properties/actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/misc";
import { DocumentStatusBadge, VisibilityBadge } from "./badges";
import { daysUntil, formatBytes, formatDay } from "./format";

export interface DocItem {
  id: string;
  category: DocumentCategory;
  type: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  expiresAt: string | null;
  visibility: DocumentVisibility;
  status: DocumentStatus;
  uploadedBy: string | null;
  createdAt: string;
  canManage: boolean;
}

interface MetaValues {
  category: DocumentCategory;
  type: string;
  name: string;
  expiresAt: string;
  visibility: DocumentVisibility;
  status: DocumentStatus;
}

function MetaFields({
  v,
  set,
  errors,
  allowConfidential,
  showCategory,
}: {
  v: MetaValues;
  set: (patch: Partial<MetaValues>) => void;
  errors: Record<string, string[]>;
  allowConfidential: boolean;
  showCategory: boolean;
}) {
  const suggestions = SUGGESTED_DOCUMENT_TYPES[v.category] ?? [];
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        {showCategory && (
          <Field label="Categoría" htmlFor="d-cat" error={errors.category}>
            <Select
              id="d-cat"
              value={v.category}
              onChange={(e) => set({ category: e.target.value as DocumentCategory })}
            >
              {DOCUMENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {DOCUMENT_CATEGORY_LABELS[c]}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Tipo de documento" htmlFor="d-type" error={errors.type}>
          <Input
            id="d-type"
            list="d-type-list"
            value={v.type}
            onChange={(e) => set({ type: e.target.value })}
          />
          <datalist id="d-type-list">
            {suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>
      </div>
      <Field label="Nombre" htmlFor="d-name" error={errors.name}>
        <Input id="d-name" maxLength={160} value={v.name} onChange={(e) => set({ name: e.target.value })} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Vence" htmlFor="d-exp" error={errors.expiresAt} hint="Opcional">
          <Input
            id="d-exp"
            type="date"
            value={v.expiresAt}
            onChange={(e) => set({ expiresAt: e.target.value })}
          />
        </Field>
        <Field label="Estado" htmlFor="d-status" error={errors.status}>
          <Select
            id="d-status"
            value={v.status}
            onChange={(e) => set({ status: e.target.value as DocumentStatus })}
          >
            {DOCUMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {DOCUMENT_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Visibilidad" htmlFor="d-vis" error={errors.visibility}>
          <Select
            id="d-vis"
            value={v.visibility}
            onChange={(e) => set({ visibility: e.target.value as DocumentVisibility })}
          >
            {DOCUMENT_VISIBILITIES.filter((x) => x !== "confidential" || allowConfidential).map((x) => (
              <option key={x} value={x}>
                {DOCUMENT_VISIBILITY_LABELS[x]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </>
  );
}

function UploadDialog({
  entityType,
  entityId,
  defaultCategory,
  allowConfidential,
}: {
  entityType: "property" | "contact";
  entityId: string;
  defaultCategory: DocumentCategory;
  allowConfidential: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const empty: MetaValues = {
    category: defaultCategory,
    type: "",
    name: "",
    expiresAt: "",
    visibility: "internal",
    status: "valid",
  };
  const [v, setV] = useState<MetaValues>(empty);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return void setErrors({ file: ["Elegí un archivo"] });
    setPending(true);
    const body = new FormData();
    body.set("file", file);
    body.set("entityType", entityType);
    body.set("entityId", entityId);
    for (const [k, val] of Object.entries(v)) body.set(k, val);
    try {
      const res = await fetch("/api/documents", { method: "POST", body });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        fieldErrors?: Record<string, string[]>;
      };
      if (!res.ok) {
        setErrors(data.fieldErrors ?? {});
        toast.error(data.error ?? "No se pudo subir el documento");
        return;
      }
      toast.success("Documento cargado");
      setOpen(false);
      router.refresh();
    } catch {
      toast.error("Error de red al subir el documento");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setV(empty);
          setFile(null);
          setErrors({});
        }
        setOpen(o);
      }}
    >
      <Button
        size="sm"
        onClick={() => {
          setV(empty);
          setFile(null);
          setErrors({});
          setOpen(true);
        }}
      >
        <Upload /> Cargar documento
      </Button>
      <DialogContent
        title="Cargar documento"
        description="PDF, JPG, PNG o WebP hasta 20 MB."
        className="max-w-xl"
      >
        <form className="grid gap-4" onSubmit={(e) => void submit(e)} noValidate>
          <Field label="Archivo" htmlFor="d-file" error={errors.file}>
            <input
              ref={fileRef}
              id="d-file"
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              className="text-sm file:mr-3 file:rounded-md file:border file:border-border-strong file:bg-surface file:px-3 file:py-1.5 file:text-sm"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                if (f && !v.name) setV((p) => ({ ...p, name: f.name.replace(/\.[a-z0-9]+$/i, "") }));
              }}
            />
          </Field>
          <MetaFields
            v={v}
            set={(patch) => setV((p) => ({ ...p, ...patch }))}
            errors={errors}
            allowConfidential={allowConfidential}
            showCategory
          />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              Cargar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({
  doc,
  allowConfidential,
  onClose,
}: {
  doc: DocItem;
  allowConfidential: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [v, setV] = useState<MetaValues>({
    category: doc.category,
    type: doc.type,
    name: doc.name,
    expiresAt: doc.expiresAt ?? "",
    visibility: doc.visibility,
    status: doc.status,
  });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="Editar documento"
        description="El archivo no cambia; solo sus datos."
        className="max-w-xl"
      >
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const r = await updateDocumentAction({ id: doc.id, ...v, expiresAt: v.expiresAt || null });
              if (!r.ok) {
                setErrors(r.fieldErrors ?? {});
                return void toast.error(r.error);
              }
              toast.success("Documento actualizado");
              onClose();
              router.refresh();
            });
          }}
        >
          <MetaFields
            v={v}
            set={(patch) => setV((p) => ({ ...p, ...patch }))}
            errors={errors}
            allowConfidential={allowConfidential || doc.visibility === "confidential"}
            showCategory={false}
          />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DocumentsPanel({
  entityType,
  entityId,
  items,
  hiddenCount,
  canUpload,
  canUploadConfidential,
  defaultCategory,
}: {
  entityType: "property" | "contact";
  entityId: string;
  items: DocItem[];
  hiddenCount: number;
  canUpload: boolean;
  canUploadConfidential: boolean;
  defaultCategory: DocumentCategory;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<DocItem | null>(null);
  const [deleting, setDeleting] = useState<DocItem | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {items.length} documento{items.length === 1 ? "" : "s"}
          {hiddenCount > 0 && (
            <span className="ml-2 inline-flex items-center gap-1">
              <Lock className="size-3" aria-hidden /> {hiddenCount} restringido{hiddenCount === 1 ? "" : "s"}{" "}
              para tu rol
            </span>
          )}
        </p>
        {canUpload && (
          <UploadDialog
            entityType={entityType}
            entityId={entityId}
            defaultCategory={defaultCategory}
            allowConfidential={canUploadConfidential}
          />
        )}
      </div>
      {items.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Sin documentos"
          description="Títulos, planos, certificados y autorizaciones quedan acá, con vencimiento y control de acceso."
        />
      ) : (
        <ul className="divide-y rounded-lg border bg-surface">
          {items.map((d) => {
            const days = d.expiresAt ? daysUntil(d.expiresAt) : null;
            return (
              <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                    {d.name}
                    <DocumentStatusBadge status={d.status} />
                    <VisibilityBadge visibility={d.visibility} />
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {d.type} · {DOCUMENT_CATEGORY_LABELS[d.category]} · {formatBytes(d.sizeBytes)} ·{" "}
                    {d.uploadedBy ?? "—"}, {new Date(d.createdAt).toLocaleDateString("es-UY")}
                    {d.expiresAt && (
                      <span
                        className={
                          days !== null && days < 0
                            ? "text-danger"
                            : days !== null && days <= 30
                              ? "text-warning"
                              : ""
                        }
                      >
                        {" "}
                        · Vence {formatDay(d.expiresAt)}
                        {days !== null && days < 0
                          ? " (vencido)"
                          : days !== null && days <= 30
                            ? ` (en ${days} días)`
                            : ""}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button asChild variant="ghost" size="sm">
                    <a href={`/api/documents/${d.id}?inline=1`} target="_blank" rel="noreferrer">
                      Ver
                    </a>
                  </Button>
                  <Button asChild variant="ghost" size="icon-sm" aria-label={`Descargar ${d.name}`}>
                    <a href={`/api/documents/${d.id}`}>
                      <Download />
                    </a>
                  </Button>
                  {d.canManage && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Editar ${d.name}`}
                        onClick={() => setEditing(d)}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Eliminar ${d.name}`}
                        onClick={() => setDeleting(d)}
                      >
                        <Trash2 />
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {editing && (
        <EditDialog
          doc={editing}
          allowConfidential={canUploadConfidential}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Dar de baja el documento"
        description="Deja de listarse, pero el archivo se conserva por trazabilidad y la baja queda auditada."
        confirmLabel="Dar de baja"
        loading={pending}
        onConfirm={() =>
          deleting &&
          startTransition(async () => {
            const r = await deleteDocumentAction(deleting.id);
            if (!r.ok) return void toast.error(r.error);
            toast.success("Documento dado de baja");
            setDeleting(null);
            router.refresh();
          })
        }
      />
    </div>
  );
}
