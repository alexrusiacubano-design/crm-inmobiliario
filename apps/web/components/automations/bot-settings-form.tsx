"use client";

import { Copy, ExternalLink, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { rotateBotTokenAction, saveBotSettingsAction } from "@/app/(app)/communications/bot/actions";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/form";
import { Card } from "@/components/ui/misc";

interface Faq {
  question: string;
  keywords: string;
  answer: string;
}

function CopyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">
        <Input readOnly value={value} className="h-8 font-mono text-xs" onFocus={(e) => e.target.select()} />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Copiar"
          onClick={() => {
            void navigator.clipboard?.writeText(value);
            toast.success("Copiado");
          }}
        >
          <Copy />
        </Button>
      </div>
    </div>
  );
}

export function BotSettingsForm({
  initial,
  chatUrl,
  widgetUrl,
  websiteListings,
}: {
  initial: {
    enabled: boolean;
    greeting: string;
    handoffMessage: string;
    faqs: { question: string; keywords: string[]; answer: string }[];
  };
  chatUrl: string;
  widgetUrl: string;
  websiteListings: number;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [greeting, setGreeting] = useState(initial.greeting);
  const [handoffMessage, setHandoff] = useState(initial.handoffMessage);
  const [faqs, setFaqs] = useState<Faq[]>(
    initial.faqs.map((f) => ({ ...f, keywords: f.keywords.join(", ") })),
  );
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  const set = (i: number, patch: Partial<Faq>) =>
    setFaqs(faqs.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <form
        className="grid content-start gap-5"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await saveBotSettingsAction({ enabled, greeting, handoffMessage, faqs });
            if (!r.ok) {
              setErrors(r.fieldErrors ?? {});
              return void toast.error(r.error);
            }
            setErrors({});
            toast.success("Asistente guardado");
            router.refresh();
          });
        }}
      >
        <Card className="grid gap-4 p-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <Checkbox checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Asistente activo en el sitio web
          </label>
          <Field label="Saludo" htmlFor="bot-g" error={errors.greeting}>
            <Textarea id="bot-g" rows={2} value={greeting} onChange={(e) => setGreeting(e.target.value)} />
          </Field>
          <Field
            label="Mensaje al dejar los datos"
            htmlFor="bot-h"
            error={errors.handoffMessage}
            hint="Los datos llegan a Comunicaciones → Consultas con el canal «Asistente virtual» y la conversación."
          >
            <Textarea
              id="bot-h"
              rows={2}
              value={handoffMessage}
              onChange={(e) => setHandoff(e.target.value)}
            />
          </Field>
        </Card>
        <Card className="grid gap-3 p-4">
          <div>
            <h2 className="text-sm font-semibold">Preguntas frecuentes</h2>
            <p className="text-xs text-muted-foreground">
              El asistente elige la respuesta cuya lista de palabras clave coincide más con la pregunta (sin
              importar tildes ni mayúsculas). Un prefijo como «garant» encuentra «garantía» y «garantías».
            </p>
          </div>
          {faqs.map((f, i) => (
            <div key={i} className="grid gap-2 rounded-md border p-3">
              <div className="flex items-start gap-2">
                <Field
                  label="Pregunta"
                  htmlFor={`fq-${i}`}
                  className="flex-1"
                  error={errors[`faqs.${i}.question`]}
                >
                  <Input
                    id={`fq-${i}`}
                    value={f.question}
                    onChange={(e) => set(i, { question: e.target.value })}
                  />
                </Field>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="mt-6"
                  aria-label="Quitar pregunta"
                  onClick={() => setFaqs(faqs.filter((_, j) => j !== i))}
                >
                  <Trash2 />
                </Button>
              </div>
              <Field
                label="Palabras clave (separadas por coma)"
                htmlFor={`fk-${i}`}
                error={errors[`faqs.${i}.keywords`]}
              >
                <Input
                  id={`fk-${i}`}
                  value={f.keywords}
                  onChange={(e) => set(i, { keywords: e.target.value })}
                />
              </Field>
              <Field label="Respuesta" htmlFor={`fa-${i}`} error={errors[`faqs.${i}.answer`]}>
                <Textarea
                  id={`fa-${i}`}
                  rows={2}
                  value={f.answer}
                  onChange={(e) => set(i, { answer: e.target.value })}
                />
              </Field>
            </div>
          ))}
          <div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={faqs.length >= 40}
              onClick={() => setFaqs([...faqs, { question: "", keywords: "", answer: "" }])}
            >
              <Plus /> Agregar pregunta
            </Button>
          </div>
        </Card>
        <div>
          <Button type="submit" loading={pending}>
            <Save /> Guardar
          </Button>
        </div>
      </form>

      <div className="grid content-start gap-4">
        <Card className="grid gap-3 p-4">
          <h2 className="text-sm font-semibold">Insertarlo en tu sitio web</h2>
          <p className="text-xs text-muted-foreground">
            Pegá esta línea antes de <code>&lt;/body&gt;</code>: aparece un botón de chat abajo a la derecha.
          </p>
          <CopyField label="Código" value={`<script src="${widgetUrl}" async></script>`} />
          <CopyField label="Enlace directo (para redes o WhatsApp)" value={chatUrl} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" asChild>
              <a href={chatUrl} target="_blank" rel="noreferrer">
                <ExternalLink /> Probar el chat
              </a>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                if (!window.confirm("El código y el enlace actuales dejan de funcionar. ¿Regenerar?")) return;
                start(async () => {
                  const r = await rotateBotTokenAction();
                  if (!r.ok) return void toast.error(r.error);
                  toast.success("Nuevo enlace generado");
                  router.refresh();
                });
              }}
            >
              <RefreshCw /> Regenerar
            </Button>
          </div>
          {!initial.enabled && (
            <p className="text-xs text-warning">Activá el asistente y guardá para que el chat responda.</p>
          )}
        </Card>
        <Card className="grid gap-1 p-4 text-sm">
          <h2 className="font-semibold">Qué hace</h2>
          <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            <li>
              Muestra propiedades publicadas en el <strong>sitio web propio</strong> (hoy: {websiteListings}).
              Se publican desde la ficha de cada propiedad.
            </li>
            <li>Reconoce códigos como «PROP-12» y muestra esa propiedad.</li>
            <li>Responde las preguntas frecuentes de la izquierda.</li>
            <li>Lo que no sabe responder lo deriva a la bandeja de consultas con los datos del cliente.</li>
            <li>
              Con una automatización «Llega una consulta» podés avisar a recepción o asignar al instante.
            </li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
