import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/misc";
import { requirePagePermission } from "@/lib/session";
import { RoleEditor } from "../role-editor";

export const metadata: Metadata = { title: "Nuevo rol" };

export default async function NewRolePage() {
  await requirePagePermission("roles.manage");
  return (
    <>
      <PageHeader title="Nuevo rol" description="Elegí los permisos y su alcance." />
      <RoleEditor />
    </>
  );
}
