import { listTemplates } from "@crm/core";
import { getDb } from "@crm/db";
import { TEMPLATE_CHANNEL_LABELS, TEMPLATE_CHANNELS } from "@crm/shared/communications";
import type { Metadata } from "next";
import { TemplateEditor } from "@/components/communications/template-editor";
import { Badge, Card, PageHeader } from "@/components/ui/misc";
import { requirePagePermission } from "@/lib/session";

export const metadata: Metadata = { title: "Plantillas" };

export default async function TemplatesPage() {
  const { ctx } = await requirePagePermission("template.manage");
  const items = await listTemplates(getDb(), ctx, { includeInactive: true });
  return (
    <>
      <PageHeader
        title="Plantillas de mensajes"
        description="Textos listos para WhatsApp y email con variables ({{nombre}}, {{propiedad}}, {{precio}}…) que se completan al enviar."
        actions={<TemplateEditor />}
      />
      <div className="grid gap-5 lg:grid-cols-2">
        {TEMPLATE_CHANNELS.map((ch) => (
          <Card key={ch}>
            <h2 className="border-b px-4 py-3 text-sm font-semibold">{TEMPLATE_CHANNEL_LABELS[ch]}</h2>
            <ul className="divide-y">
              {items
                .filter((t) => t.channel === ch)
                .map((t) => (
                  <li key={t.id} className="flex items-start justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        {t.name} {!t.active && <Badge tone="neutral">Inactiva</Badge>}
                      </p>
                      {t.subject && <p className="text-xs text-muted-foreground">Asunto: {t.subject}</p>}
                      <p className="mt-1 line-clamp-3 text-sm whitespace-pre-wrap text-muted-foreground">
                        {t.body}
                      </p>
                    </div>
                    <TemplateEditor
                      existing={{
                        id: t.id,
                        name: t.name,
                        channel: t.channel,
                        subject: t.subject,
                        body: t.body,
                        active: t.active,
                      }}
                    />
                  </li>
                ))}
            </ul>
          </Card>
        ))}
      </div>
    </>
  );
}
