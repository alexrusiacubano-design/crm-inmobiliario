"use client";

import { Megaphone, Pause, Pencil, Play, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AD_LEVEL_LABELS,
  AD_LEVELS,
  PORTAL_LABELS,
  type AdLevel,
  type Portal,
  type PublicationStatus,
} from "@crm/shared/publications";
import {
  changePublicationStatusAction,
  publishPropertyAction,
  updatePublicationAction,
} from "@/app/(app)/properties/publications/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";

type Result = {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
  data?: { portalError?: string | null };
};

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const run = (fn: () => Promise<Result>, ok: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        return void toast.error(r.error);
      }
      setErrors({});
      toast.success(ok);
      if (r.data?.portalError)
        toast.warning(`Se guardó en el CRM, pero el portal respondió con un error: ${r.data.portalError}`, {
          duration: 12_000,
        });
      after?.();
      router.refresh();
    });
  return { pending, errors, run };
}

export function PublishButton({
  propertyId,
  portals,
  missing,
}: {
  propertyId: string;
  /** Portales activos donde todavía no está publicada. */
  portals: Portal[];
  missing: string[];
}) {
  const [open, setOpen] = useState(false);
  const [portal, setPortal] = useState<Portal>(portals[0] ?? "website");
  const [level, setLevel] = useState<AdLevel>("basic");
  const [url, setUrl] = useState("");
  const [externalId, setExternalId] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [notes, setNotes] = useState("");
  const { pending, errors, run } = useRun();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" onClick={() => setOpen(true)} disabled={!portals.length}>
        <Megaphone /> Publicar en portal
      </Button>
      <DialogContent
        title="Publicar en portal"
        description="Registrá el aviso: nivel, enlace y vencimiento. La propiedad pasa a Publicada."
      >
        {missing.length > 0 ? (
          <div className="rounded-md bg-warning-soft/50 p-3 text-sm">
            <p className="font-medium">Antes de publicar falta:</p>
            <ul className="mt-1 list-disc pl-5">
              {missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        ) : (
          <form
            className="grid gap-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () => publishPropertyAction({ propertyId, portal, level, url, externalId, expiresAt, notes }),
                `Publicada en ${PORTAL_LABELS[portal]}`,
                () => setOpen(false),
              );
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Portal" htmlFor="pb-p">
                <Select id="pb-p" value={portal} onChange={(e) => setPortal(e.target.value as Portal)}>
                  {portals.map((p) => (
                    <option key={p} value={p}>
                      {PORTAL_LABELS[p]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Nivel del aviso" htmlFor="pb-l">
                <Select id="pb-l" value={level} onChange={(e) => setLevel(e.target.value as AdLevel)}>
                  {AD_LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {AD_LEVEL_LABELS[l]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Enlace del aviso" htmlFor="pb-u" error={errors.url}>
                <Input
                  id="pb-u"
                  placeholder="https://…"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </Field>
              <Field label="Código en el portal" htmlFor="pb-x">
                <Input id="pb-x" value={externalId} onChange={(e) => setExternalId(e.target.value)} />
              </Field>
              <Field label="Vence" htmlFor="pb-e" error={errors.expiresAt}>
                <Input
                  id="pb-e"
                  type="date"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                />
              </Field>
            </div>
            <Field label="Notas" htmlFor="pb-n">
              <Textarea id="pb-n" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button type="submit" loading={pending}>
                Publicar
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export interface PublicationView {
  id: string;
  portal: Portal;
  level: AdLevel;
  status: PublicationStatus;
  url: string | null;
  externalId: string | null;
  expiresAt: string | null;
  views: number | null;
  contacts: number | null;
  notes: string | null;
}

export function PublicationActions({ p }: { p: PublicationView }) {
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<AdLevel>(p.level);
  const [url, setUrl] = useState(p.url ?? "");
  const [externalId, setExternalId] = useState(p.externalId ?? "");
  const [expiresAt, setExpiresAt] = useState(p.expiresAt ?? "");
  const [views, setViews] = useState(p.views?.toString() ?? "");
  const [contacts, setContacts] = useState(p.contacts?.toString() ?? "");
  const [notes, setNotes] = useState(p.notes ?? "");
  const { pending, errors, run } = useRun();
  const move = (status: PublicationStatus, ok: string) =>
    run(() => changePublicationStatusAction({ id: p.id, status }), ok);
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {p.status === "published" && (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => move("paused", "Aviso pausado")}>
          <Pause /> Pausar
        </Button>
      )}
      {(p.status === "paused" || p.status === "expired" || p.status === "removed") && (
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => move("published", "Aviso publicado")}
        >
          <Play /> Publicar
        </Button>
      )}
      {p.status !== "removed" && (
        <Button
          size="sm"
          variant="ghost"
          className="text-danger"
          disabled={pending}
          onClick={() => move("removed", "Aviso dado de baja")}
        >
          <Trash2 /> Bajar
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <Button size="icon-sm" variant="ghost" aria-label="Editar aviso" onClick={() => setOpen(true)}>
          <Pencil />
        </Button>
        <DialogContent title={`Aviso en ${PORTAL_LABELS[p.portal]}`}>
          <form
            className="grid gap-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () =>
                  updatePublicationAction({
                    id: p.id,
                    level,
                    url,
                    externalId,
                    expiresAt,
                    views,
                    contacts,
                    notes,
                  }),
                "Aviso actualizado",
                () => setOpen(false),
              );
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nivel" htmlFor={`pe-l-${p.id}`}>
                <Select
                  id={`pe-l-${p.id}`}
                  value={level}
                  onChange={(e) => setLevel(e.target.value as AdLevel)}
                >
                  {AD_LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {AD_LEVEL_LABELS[l]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Vence" htmlFor={`pe-e-${p.id}`}>
                <Input
                  id={`pe-e-${p.id}`}
                  type="date"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                />
              </Field>
              <Field label="Enlace" htmlFor={`pe-u-${p.id}`} error={errors.url}>
                <Input id={`pe-u-${p.id}`} value={url} onChange={(e) => setUrl(e.target.value)} />
              </Field>
              <Field label="Código en el portal" htmlFor={`pe-x-${p.id}`}>
                <Input
                  id={`pe-x-${p.id}`}
                  value={externalId}
                  onChange={(e) => setExternalId(e.target.value)}
                />
              </Field>
              <Field label="Visitas al aviso" htmlFor={`pe-v-${p.id}`}>
                <Input
                  id={`pe-v-${p.id}`}
                  inputMode="numeric"
                  value={views}
                  onChange={(e) => setViews(e.target.value.replace(/\D/g, ""))}
                />
              </Field>
              <Field label="Contactos recibidos" htmlFor={`pe-c-${p.id}`}>
                <Input
                  id={`pe-c-${p.id}`}
                  inputMode="numeric"
                  value={contacts}
                  onChange={(e) => setContacts(e.target.value.replace(/\D/g, ""))}
                />
              </Field>
            </div>
            <Field label="Notas" htmlFor={`pe-n-${p.id}`}>
              <Textarea
                id={`pe-n-${p.id}`}
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button type="submit" loading={pending}>
                Guardar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
