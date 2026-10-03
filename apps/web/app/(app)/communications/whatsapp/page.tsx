import type { Metadata } from "next";
import { Composer } from "@/components/communications/composer";
import { Card, PageHeader } from "@/components/ui/misc";
import { requirePagePermission } from "@/lib/session";

export const metadata: Metadata = { title: "WhatsApp" };

export default async function WhatsAppPage() {
  await requirePagePermission("communication.send");
  return (
    <>
      <PageHeader
        title="WhatsApp"
        description="Armá el mensaje con una plantilla y se abre tu WhatsApp (web o app) con el texto listo. Queda registrado en el historial del cliente. El envío automático desde el CRM requiere conectar WhatsApp Business Platform."
      />
      <Card className="max-w-3xl p-5">
        <Composer channel="whatsapp" />
      </Card>
    </>
  );
}
