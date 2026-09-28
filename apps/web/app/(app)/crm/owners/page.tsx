import type { Metadata } from "next";
import { ContactsListPage } from "@/components/crm/contacts-list-page";
import { requirePagePermission } from "@/lib/session";

export const metadata: Metadata = { title: "Propietarios" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { ctx } = await requirePagePermission("owner.read");
  return (
    <ContactsListPage
      ctx={ctx}
      role="owner"
      title="Propietarios"
      description="Contactos con datos de propietario. Los datos bancarios solo los ve quien tiene permiso."
      params={await searchParams}
    />
  );
}
