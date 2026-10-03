"use client";

import { Mail, MessageCircle, Send } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { renderTemplate, type TemplateChannel } from "@crm/shared/communications";
import { composeDataAction, logOutboundAction, type ComposeData } from "@/app/(app)/communications/actions";
import { Picker } from "@/components/deals/new-deal-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { whatsappLink } from "@/lib/utils";

interface Link {
  id: string;
  label: string;
}

/** Arma el mensaje con una plantilla, lo abre en WhatsApp o el correo y lo deja en el timeline. */
export function Composer({
  channel,
  contact: presetContact,
  leadId,
  property: presetProperty,
  onDone,
}: {
  channel: TemplateChannel;
  contact?: Link;
  leadId?: string | null;
  property?: Link | null;
  onDone?: () => void;
}) {
  const [who, setWho] = useState<Link | null>(presetContact ?? null);
  const [prop, setProp] = useState<Link | null>(presetProperty ?? null);
  const [data, setData] = useState<ComposeData | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [loading, startLoad] = useTransition();
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!who) return setData(null);
    startLoad(async () => {
      const r = await composeDataAction({ contactId: who.id, propertyId: prop?.id ?? null, channel });
      if (!r.ok) return void toast.error(r.error);
      setData(r.data);
    });
  }, [who, prop, channel]);

  useEffect(() => {
    if (!data || !templateId) return;
    const t = data.templates.find((x) => x.id === templateId);
    if (!t) return;
    setBody(renderTemplate(t.body, data.values));
    setSubject(t.subject ? renderTemplate(t.subject, data.values) : "");
  }, [templateId, data]);

  const target =
    channel === "whatsapp" ? whatsappLink(data?.whatsapp) : data?.email ? `mailto:${data.email}` : null;
  const href =
    target && body
      ? channel === "whatsapp"
        ? `${target}?text=${encodeURIComponent(body)}`
        : `${target}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
      : null;

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {presetContact ? (
          <Field label="Para">
            <p className="flex h-9 items-center rounded-md border bg-surface-muted px-3 text-sm">
              {presetContact.label}
            </p>
          </Field>
        ) : (
          <Picker kind="contact" label="Para" value={who} onChange={setWho} />
        )}
        <Picker kind="property" label="Propiedad (opcional)" value={prop} onChange={setProp} />
      </div>
      {who && (
        <>
          {data && !target && (
            <p className="rounded-md bg-warning-soft/50 px-3 py-2 text-sm">
              {data.displayName} no tiene {channel === "whatsapp" ? "teléfono" : "email"} cargado.
            </p>
          )}
          <Field label="Plantilla" htmlFor="cp-t">
            <Select
              id="cp-t"
              value={templateId}
              disabled={loading || !data}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              <option value="">Mensaje libre</option>
              {data?.templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          {channel === "email" && (
            <Field label="Asunto" htmlFor="cp-s">
              <Input id="cp-s" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </Field>
          )}
          <Field label="Mensaje" htmlFor="cp-b" hint="Revisá los “…”: son datos que faltan completar.">
            <Textarea id="cp-b" rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
          <div className="flex justify-end">
            <Button
              asChild={Boolean(href)}
              disabled={!href || pending}
              onClick={() => {
                if (!href || !who) return;
                start(async () => {
                  const r = await logOutboundAction({
                    contactId: who.id,
                    leadId: leadId ?? null,
                    channel,
                    templateId: templateId || null,
                    body,
                    subject: channel === "email" ? subject : null,
                  });
                  if (!r.ok) return void toast.error(r.error);
                  toast.success("Mensaje registrado en el historial");
                  onDone?.();
                });
              }}
            >
              {href ? (
                <a href={href} target="_blank" rel="noreferrer">
                  {channel === "whatsapp" ? <MessageCircle /> : <Mail />} Abrir{" "}
                  {channel === "whatsapp" ? "WhatsApp" : "correo"} y registrar
                </a>
              ) : (
                <span>
                  <Send /> Abrir y registrar
                </span>
              )}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

export function ComposerButton({
  channel,
  contact,
  leadId,
  label,
}: {
  channel: TemplateChannel;
  contact: Link;
  leadId?: string | null;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        {channel === "whatsapp" ? <MessageCircle /> : <Mail />}{" "}
        {label ?? (channel === "whatsapp" ? "WhatsApp" : "Email")}
      </Button>
      <DialogContent
        title={channel === "whatsapp" ? "Mensaje de WhatsApp" : "Email"}
        description="Elegí una plantilla, revisá el texto y se abre tu WhatsApp o correo. Queda registrado en el historial."
        className="max-w-2xl"
      >
        <Composer channel={channel} contact={contact} leadId={leadId} onDone={() => setOpen(false)} />
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
