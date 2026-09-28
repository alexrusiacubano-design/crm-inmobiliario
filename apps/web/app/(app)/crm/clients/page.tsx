import type { Metadata } from "next";
import { ContactsListPage } from "@/components/crm/contacts-list-page";
import { requirePagePermission } from "@/lib/session";

export const metadata: Metadata = { title: "Clientes" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { ctx } = await requirePagePermission("lead.read");
  return (
    <ContactsListPage
      ctx={ctx}
      role="client"
      title="Clientes"
      description="Contactos con al menos un lead abierto (compradores e inquilinos)."
      params={await searchParams}
    />
  );
}
