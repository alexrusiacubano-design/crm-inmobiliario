import type { Metadata } from "next";
import { Composer } from "@/components/communications/composer";
import { Card, PageHeader } from "@/components/ui/misc";
import { requirePagePermission } from "@/lib/session";

export const metadata: Metadata = { title: "Email" };

export default async function EmailPage() {
  await requirePagePermission("communication.send");
  return (
    <>
      <PageHeader
        title="Email"
        description="Armá el mensaje con una plantilla y se abre tu programa de correo con el texto listo. Queda registrado en el historial del cliente. El envío automático desde el CRM requiere conectar un proveedor de email."
      />
      <Card className="max-w-3xl p-5">
        <Composer channel="email" />
      </Card>
    </>
  );
}
