import { hasPermission, listBranches } from "@crm/core";
import { getDb } from "@crm/db";
import { Building2 } from "lucide-react";
import type { Metadata } from "next";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requirePagePermission } from "@/lib/session";
import { BranchRowActions, NewBranchButton } from "./branch-form";

export const metadata: Metadata = { title: "Sucursales" };

export default async function BranchesPage() {
  const { ctx } = await requirePagePermission("users.read");
  const branches = await listBranches(getDb(), ctx);
  const canManage = hasPermission(ctx, "branches.manage");

  return (
    <>
      <PageHeader
        title="Sucursales"
        description="Cada propiedad, lead y operación va a pertenecer a una sucursal. Los roles pueden limitarse a una sucursal."
        actions={canManage ? <NewBranchButton /> : undefined}
      />
      <Card>
        {branches.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="Todavía no hay sucursales"
            description="Creá la primera para organizar usuarios y equipos."
          />
        ) : (
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Sucursal</TH>
                <TH>Código</TH>
                <TH className="hidden md:table-cell">Dirección</TH>
                <TH className="text-right">Equipos</TH>
                <TH className="text-right">Usuarios</TH>
                <TH>Estado</TH>
                {canManage && <TH className="text-right">Acciones</TH>}
              </TR>
            </THead>
            <TBody>
              {branches.map((b) => (
                <TR key={b.id}>
                  <TD className="font-medium">{b.name}</TD>
                  <TD className="font-mono text-xs">{b.code}</TD>
                  <TD className="hidden text-muted-foreground md:table-cell">{b.address ?? "—"}</TD>
                  <TD className="text-right tabular">{b.teamCount}</TD>
                  <TD className="text-right tabular">{b.memberCount}</TD>
                  <TD>
                    <Badge tone={b.isActive ? "success" : "neutral"}>
                      {b.isActive ? "Activa" : "Inactiva"}
                    </Badge>
                  </TD>
                  {canManage && (
                    <TD>
                      <BranchRowActions
                        branch={{
                          id: b.id,
                          name: b.name,
                          code: b.code,
                          address: b.address,
                          phone: b.phone,
                          isActive: b.isActive,
                        }}
                      />
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
