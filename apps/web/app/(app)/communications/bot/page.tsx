import { getBotSettings, hasPermission, listPublications } from "@crm/core";
import { getDb } from "@crm/db";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { BotSettingsForm } from "@/components/automations/bot-settings-form";
import { PageHeader } from "@/components/ui/misc";
import { requirePagePermission } from "@/lib/session";
import { DEFAULT_TZ, ymdInTz } from "@/lib/tz";

export const metadata: Metadata = { title: "Asistente virtual" };

export default async function BotPage() {
  const { ctx } = await requirePagePermission("automation.manage");
  const db = getDb();
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${proto}://${host}`;
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
