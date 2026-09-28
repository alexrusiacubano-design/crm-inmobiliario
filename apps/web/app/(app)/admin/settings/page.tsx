import { getOrganization } from "@crm/core";
import { getDb } from "@crm/db";
import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/misc";
import { requirePagePermission } from "@/lib/session";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Configuración" };

export default async function SettingsPage() {
  const { ctx } = await requirePagePermission("settings.manage");
  const org = await getOrganization(getDb(), ctx);
  return (
    <>
      <PageHeader
        title="Configuración"
        description="Datos generales de la organización. Cada cambio queda en la auditoría."
      />
      <SettingsForm
        initial={{ name: org.name, defaultCurrency: org.defaultCurrency, timezone: org.timezone }}
      />
    </>
  );
}
