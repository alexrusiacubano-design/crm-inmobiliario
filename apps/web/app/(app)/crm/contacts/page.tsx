import type { Metadata } from "next";
import { ContactsListPage } from "@/components/crm/contacts-list-page";
import { requirePagePermission } from "@/lib/session";

export const metadata: Metadata = { title: "Contactos" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { ctx } = await requirePagePermission("contact.read");
  return (
    <ContactsListPage
      ctx={ctx}
      role="all"
      title="Contactos"
      description="Todas las personas y empresas: clientes, propietarios, garantes y otros."
      params={await searchParams}
    />
  );
}
