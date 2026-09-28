import { listRoles } from "@crm/core";
import { getDb } from "@crm/db";
import { Lock, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge, Card, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requirePagePermission } from "@/lib/session";

export const metadata: Metadata = { title: "Roles y permisos" };

export default async function RolesPage() {
  const { ctx } = await requirePagePermission("roles.manage");
  const roles = await listRoles(getDb(), ctx);

  return (
    <>
      <PageHeader
        title="Roles y permisos"
        description="Los roles agrupan permisos granulares con alcance. Podés ajustar los roles iniciales o crear los tuyos."
        actions={
          <Button asChild>
            <Link href="/admin/roles/new">
              <Plus /> Nuevo rol
            </Link>
          </Button>
        }
      />
      <Card>
        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              <TH>Rol</TH>
              <TH>Tipo</TH>
              <TH className="text-right">Permisos</TH>
              <TH className="text-right">Usuarios</TH>
            </TR>
          </THead>
          <TBody>
            {roles.map((r) => (
              <TR key={r.id}>
                <TD>
                  <Link href={`/admin/roles/${r.id}`} className="font-medium hover:underline">
                    {r.name}
                  </Link>
                  {r.description && <p className="text-xs text-muted-foreground">{r.description}</p>}
                </TD>
                <TD>
                  {r.isLocked ? (
                    <Badge tone="outline">
                      <Lock className="size-3" /> Bloqueado
                    </Badge>
                  ) : r.isSystem ? (
                    <Badge>Inicial</Badge>
                  ) : (
                    <Badge tone="primary">Personalizado</Badge>
                  )}
                </TD>
                <TD className="text-right tabular">{r.permissionCount}</TD>
                <TD className="text-right tabular">{r.memberCount}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </>
  );
}
