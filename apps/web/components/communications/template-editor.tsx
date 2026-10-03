"use client";

import { Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  renderTemplate,
  TEMPLATE_CHANNEL_LABELS,
  TEMPLATE_CHANNELS,
  TEMPLATE_VARIABLES,
  type TemplateChannel,
  type TemplateVariable,
} from "@crm/shared/communications";
import { saveTemplateAction } from "@/app/(app)/communications/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";

const SAMPLE: Partial<Record<TemplateVariable, string>> = {
  nombre: "Ana",
  apellido: "Pérez",
  agente: "Martín",
  inmobiliaria: "Tu inmobiliaria",
  propiedad: "Apartamento 2 dormitorios",
  codigo: "PROP-000001",
  direccion: "Bvar. España 2500",
  precio: "U$S 229.000",
  fecha: "viernes 10/10",
  hora: "18:00",
};

export function TemplateEditor({
  existing,
}: {
  existing?: {
    id: string;
    name: string;
    channel: TemplateChannel;
    subject: string | null;
    body: string;
    active: boolean;
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(existing?.name ?? "");
  const [channel, setChannel] = useState<TemplateChannel>(existing?.channel ?? "whatsapp");
  const [subject, setSubject] = useState(existing?.subject ?? "");
  const [body, setBody] = useState(existing?.body ?? "");
  const [active, setActive] = useState(existing?.active ?? true);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {existing ? (
        <Button size="icon-sm" variant="ghost" aria-label="Editar" onClick={() => setOpen(true)}>
          <Pencil />
        </Button>
      ) : (
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus /> Nueva plantilla
        </Button>
      )}
      <DialogContent title={existing ? "Editar plantilla" : "Nueva plantilla"} className="max-w-2xl">
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await saveTemplateAction({
                id: existing?.id ?? null,
                name,
                channel,
                subject,
                body,
                active,
              });
              if (!r.ok) {
                setErrors(r.fieldErrors ?? {});
                return void toast.error(r.error);
              }
              toast.success("Plantilla guardada");
              setOpen(false);
              router.refresh();
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nombre" htmlFor="tp-n" error={errors.name}>
              <Input id="tp-n" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Canal" htmlFor="tp-c">
              <Select
                id="tp-c"
                value={channel}
                onChange={(e) => setChannel(e.target.value as TemplateChannel)}
              >
                {TEMPLATE_CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {TEMPLATE_CHANNEL_LABELS[c]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {channel === "email" && (
            <Field label="Asunto" htmlFor="tp-s">
              <Input id="tp-s" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </Field>
          )}
          <Field label="Texto" htmlFor="tp-b" error={errors.body}>
            <Textarea id="tp-b" rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-1">
            {(Object.entries(TEMPLATE_VARIABLES) as [TemplateVariable, string][]).map(([k, label]) => (
              <button
                key={k}
                type="button"
                title={label}
                className="rounded border px-1.5 py-0.5 font-mono text-xs text-muted-foreground hover:bg-surface-muted"
                onClick={() => setBody(`${body}{{${k}}}`)}
              >
                {`{{${k}}}`}
              </button>
            ))}
          </div>
          {body && (
            <div className="rounded-md bg-surface-muted/60 p-3 text-sm whitespace-pre-wrap">
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                Vista previa con datos de ejemplo
              </p>
              {renderTemplate(body, SAMPLE)}
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={active} onChange={(e) => setActive(e.target.checked)} /> Activa (aparece al
            enviar mensajes)
          </label>
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
  );
}
