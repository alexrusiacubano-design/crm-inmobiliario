"use client";

import { ArrowLeft, ArrowRight, ImagePlus, Link2, PlayCircle, Star, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { MEDIA_KIND_LABELS, type MediaKind } from "@crm/shared/property";
import {
  addVideoAction,
  deleteMediaAction,
  reorderMediaAction,
  setCoverAction,
  updateMediaAction,
} from "@/app/(app)/properties/actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { Badge, EmptyState } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { PrivateImage } from "./private-image";

export interface MediaItem {
  id: string;
  kind: MediaKind;
  url: string | null;
  caption: string | null;
  isCover: boolean;
  width: number | null;
  height: number | null;
}

function VideoDialog({ propertyId }: { propertyId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<string[] | undefined>();
  const [pending, startTransition] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Link2 /> Agregar video
      </Button>
      <DialogContent
        title="Agregar video"
        description="Enlace a YouTube o Vimeo. El video no se aloja en el CRM."
      >
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const r = await addVideoAction({ propertyId, url, caption });
              if (!r.ok) {
                setError(r.fieldErrors?.url ?? [r.error]);
                return;
              }
              toast.success("Video agregado");
              setOpen(false);
              setUrl("");
              setCaption("");
              router.refresh();
            });
          }}
        >
          <Field label="URL" htmlFor="v-url" error={error}>
            <Input
              id="v-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=…"
            />
          </Field>
          <Field label="Descripción (opcional)" htmlFor="v-cap">
            <Input id="v-cap" value={caption} onChange={(e) => setCaption(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              Agregar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditMediaDialog({ item, onClose }: { item: MediaItem; onClose: () => void }) {
  const router = useRouter();
  const [caption, setCaption] = useState(item.caption ?? "");
  const [kind, setKind] = useState<MediaKind>(item.kind);
  const [pending, startTransition] = useTransition();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Editar archivo">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const r = await updateMediaAction({
                mediaId: item.id,
                caption,
                ...(item.kind !== "video" ? { kind } : {}),
              });
              if (!r.ok) return void toast.error(r.error);
              toast.success("Guardado");
              onClose();
              router.refresh();
            });
          }}
        >
          <Field label="Descripción" htmlFor="m-cap">
            <Input id="m-cap" maxLength={200} value={caption} onChange={(e) => setCaption(e.target.value)} />
          </Field>
          {item.kind !== "video" && (
            <Field label="Tipo" htmlFor="m-kind">
              <Select id="m-kind" value={kind} onChange={(e) => setKind(e.target.value as MediaKind)}>
                <option value="photo">Foto</option>
                <option value="floor_plan">Plano</option>
              </Select>
            </Field>
          )}
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

export function MediaManager({
  propertyId,
  items,
  canEdit,
}: {
  propertyId: string;
  items: MediaItem[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [kind, setKind] = useState<"photo" | "floor_plan">("photo");
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<MediaItem | null>(null);
  const [deleting, setDeleting] = useState<MediaItem | null>(null);

  const upload = async (files: FileList) => {
    const list = [...files];
    setUploading({ done: 0, total: list.length });
    let ok = 0;
    // Secuencial: el servidor procesa cada imagen (redimensión y miniatura).
    for (const [i, file] of list.entries()) {
      const body = new FormData();
      body.set("file", file);
      body.set("kind", kind);
      try {
        const res = await fetch(`/api/properties/${propertyId}/media`, { method: "POST", body });
        if (res.ok) ok += 1;
        else {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          toast.error(`${file.name}: ${data.error ?? "no se pudo subir"}`);
        }
      } catch {
        toast.error(`${file.name}: error de red`);
      }
      setUploading({ done: i + 1, total: list.length });
    }
    setUploading(null);
    if (input.current) input.current.value = "";
    if (ok) toast.success(ok === 1 ? "Archivo subido" : `${ok} archivos subidos`);
    router.refresh();
  };

  const move = (index: number, delta: number) => {
    const ids = items.map((m) => m.id);
    const j = index + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j] as string, ids[index] as string];
    startTransition(async () => {
      const r = await reorderMediaAction({ propertyId, orderedIds: ids });
      if (!r.ok) return void toast.error(r.error);
      router.refresh();
    });
  };

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string) =>
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error ?? "Error");
      toast.success(success);
      setDeleting(null);
      router.refresh();
    });

  const photos = items.filter((m) => m.kind === "photo").length;

  return (
    <div className="grid gap-4">
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label="Tipo de archivo"
            value={kind}
            onChange={(e) => setKind(e.target.value as "photo" | "floor_plan")}
            className="h-8 w-32 text-sm"
          >
            <option value="photo">Fotos</option>
            <option value="floor_plan">Planos</option>
          </Select>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="sr-only"
            id="media-upload"
            onChange={(e) => e.target.files?.length && void upload(e.target.files)}
          />
          <Button size="sm" loading={!!uploading} onClick={() => input.current?.click()}>
            <ImagePlus />
            {uploading ? `Subiendo ${uploading.done}/${uploading.total}…` : "Subir imágenes"}
          </Button>
          <VideoDialog propertyId={propertyId} />
          <p className="text-xs text-muted-foreground">
            JPG, PNG o WebP hasta 12 MB. Se quitan los metadatos (EXIF/GPS) y se optimizan.
          </p>
        </div>
      )}
      {photos < 3 && (
        <p className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm">
          Para publicar hacen falta al menos 3 fotos ({photos} cargada{photos === 1 ? "" : "s"}).
        </p>
      )}
      {items.length === 0 ? (
        <EmptyState
          icon={ImagePlus}
          title="Sin fotos todavía"
          description="La primera foto que subas queda como portada."
        />
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4" aria-busy={pending}>
          {items.map((m, i) => (
            <li
              key={m.id}
              className={cn(
                "overflow-hidden rounded-lg border bg-surface",
                m.isCover && "ring-2 ring-primary",
              )}
            >
              <div className="relative aspect-[4/3] bg-surface-muted">
                {m.kind === "video" ? (
                  <a
                    href={m.url ?? "#"}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="flex size-full flex-col items-center justify-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                  >
                    <PlayCircle className="size-8" aria-hidden />
                    Ver video
                  </a>
                ) : (
                  <a href={`/api/media/${m.id}`} target="_blank" rel="noreferrer">
                    <PrivateImage mediaId={m.id} alt={m.caption ?? `${MEDIA_KIND_LABELS[m.kind]} ${i + 1}`} />
                  </a>
                )}
                <div className="absolute left-1.5 top-1.5 flex gap-1">
                  {m.isCover && (
                    <Badge tone="primary" className="bg-primary text-primary-foreground">
                      Portada
                    </Badge>
                  )}
                  {m.kind !== "photo" && <Badge className="bg-surface/90">{MEDIA_KIND_LABELS[m.kind]}</Badge>}
                </div>
              </div>
              <div className="grid gap-1 px-2 py-1.5">
                <p className="truncate text-xs text-muted-foreground" title={m.caption ?? undefined}>
                  {m.caption || (m.width ? `${m.width}×${m.height}` : "Sin descripción")}
                </p>
                {canEdit && (
                  <div className="flex items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Mover antes"
                      disabled={i === 0 || pending}
                      onClick={() => move(i, -1)}
                    >
                      <ArrowLeft />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Mover después"
                      disabled={i === items.length - 1 || pending}
                      onClick={() => move(i, 1)}
                    >
                      <ArrowRight />
                    </Button>
                    {m.kind === "photo" && !m.isCover && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Usar como portada"
                        title="Usar como portada"
                        disabled={pending}
                        onClick={() => run(() => setCoverAction(m.id), "Portada actualizada")}
                      >
                        <Star />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto h-8 px-2 text-xs"
                      onClick={() => setEditing(m)}
                    >
                      Editar
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Eliminar"
                      onClick={() => setDeleting(m)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && <EditMediaDialog item={editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Eliminar archivo"
        description={
          deleting?.isCover
            ? "Es la portada: la siguiente foto pasará a serlo. El archivo se borra definitivamente."
            : "El archivo se borra definitivamente."
        }
        confirmLabel="Eliminar"
        loading={pending}
        onConfirm={() => deleting && run(() => deleteMediaAction(deleting.id), "Archivo eliminado")}
      />
    </div>
  );
}
