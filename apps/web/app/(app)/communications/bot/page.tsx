import { getBotSettings, hasPermission, listPublications } from "@crm/core";
import { getDb } from "@crm/db";
import type { Metadata } from "next";
import { publicOrigin } from "@/lib/public-origin";
import { BotSettingsForm } from "@/components/automations/bot-settings-form";
import { PageHeader } from "@/components/ui/misc";
import { requirePagePermission } from "@/lib/session";
import { DEFAULT_TZ, ymdInTz } from "@/lib/tz";

export const metadata: Metadata = { title: "Asistente virtual" };

export default async function BotPage() {
  const { ctx } = await requirePagePermission("automation.manage");
  const db = getDb();
  const origin = await publicOrigin();
  const today = ymdInTz(new Date(), ctx.organization.timezone || DEFAULT_TZ);
  const [s, pubs] = await Promise.all([
    getBotSettings(db, ctx),
    hasPermission(ctx, "publication.read")
      ? listPublications(db, ctx, { portal: "website", status: "published", today })
      : Promise.resolve(null),
  ]);
  return (
    <>
      <PageHeader
        title="Asistente virtual"
        description="Chat para tu sitio web: muestra propiedades, responde preguntas frecuentes y deriva al equipo lo que no puede resolver."
      />
      <BotSettingsForm
        initial={{ enabled: s.enabled, greeting: s.greeting, handoffMessage: s.handoffMessage, faqs: s.faqs }}
        chatUrl={`${origin}/chat/${s.token}`}
        widgetUrl={`${origin}/api/bot/${s.token}/widget`}
        websiteListings={pubs?.items.length ?? 0}
      />
    </>
  );
}
