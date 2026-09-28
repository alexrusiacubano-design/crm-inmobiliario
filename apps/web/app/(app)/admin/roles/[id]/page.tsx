import { getRole, listRoles, NotFoundError, ValidationError } from "@crm/core";
import { getDb } from "@crm/db";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/misc";
import { requirePagePermission } from "@/lib/session";
import { RoleEditor } from "../role-editor";

export const metadata: Metadata = { title: "Rol" };

export default async function RolePage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requirePagePermission("roles.manage");
  const { id } = await params;
  const db = getDb();
  const role = await getRole(db, ctx, id).catch((error: unknown) => {
    if (error instanceof NotFoundError || error instanceof ValidationError) notFound();
    throw error;
  });
  const memberCount = (await listRoles(db, ctx)).find((r) => r.id === role.id)?.memberCount ?? 0;

  return (
    <>
      <PageHeader
        title={role.name}
        description={`${memberCount} ${memberCount === 1 ? "usuario tiene" : "usuarios tienen"} este rol.`}
      />
      <RoleEditor
        memberCount={memberCount}
        role={{
          id: role.id,
          name: role.name,
          description: role.description,
          isSystem: role.isSystem,
          isLocked: role.isLocked,
          grants: role.grants,
        }}
      />
    </>
  );
}
