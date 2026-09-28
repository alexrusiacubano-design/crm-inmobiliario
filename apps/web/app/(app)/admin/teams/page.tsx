import { hasPermission, listBranches, listMembers, listTeams } from "@crm/core";
import { getDb } from "@crm/db";
import { UsersRound } from "lucide-react";
import type { Metadata } from "next";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requirePagePermission } from "@/lib/session";
import { NewTeamButton, TeamRowActions, type TeamLookups } from "./team-form";

export const metadata: Metadata = { title: "Equipos" };

export default async function TeamsPage() {
  const { ctx } = await requirePagePermission("users.read");
  const db = getDb();
  const canManage = hasPermission(ctx, "teams.manage");
  const [teams, branches, members] = await Promise.all([
    listTeams(db, ctx),
    canManage ? listBranches(db, ctx) : Promise.resolve([]),
    canManage ? listMembers(db, ctx, { page: 1, pageSize: 100 }) : Promise.resolve(null),
  ]);

  const lookups: TeamLookups = {
    branches: branches.filter((b) => b.isActive).map((b) => ({ id: b.id, name: b.name })),
    members: (members?.items ?? [])
      .filter((m) => m.status === "active")
      .map((m) => ({ membershipId: m.membershipId, name: m.name, email: m.email })),
  };

  return (
    <>
      <PageHeader
        title="Equipos"
        description="Los supervisores ven y gestionan el trabajo de su equipo (alcance «Equipo» en los permisos)."
        actions={canManage ? <NewTeamButton lookups={lookups} /> : undefined}
      />
      <Card>
        {teams.length === 0 ? (
          <EmptyState
            icon={UsersRound}
            title="Todavía no hay equipos"
            description="Los equipos agrupan agentes dentro de una sucursal."
          />
        ) : (
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Equipo</TH>
                <TH>Sucursal</TH>
                <TH className="hidden md:table-cell">Responsable</TH>
                <TH className="text-right">Miembros</TH>
                <TH>Estado</TH>
                {canManage && <TH className="text-right">Acciones</TH>}
              </TR>
            </THead>
            <TBody>
              {teams.map((t) => (
                <TR key={t.id}>
                  <TD className="font-medium">{t.name}</TD>
                  <TD className="text-muted-foreground">{t.branchName}</TD>
                  <TD className="hidden text-muted-foreground md:table-cell">{t.leadName ?? "—"}</TD>
                  <TD className="text-right tabular">{t.memberCount}</TD>
                  <TD>
                    <Badge tone={t.isActive ? "success" : "neutral"}>
                      {t.isActive ? "Activo" : "Inactivo"}
                    </Badge>
                  </TD>
                  {canManage && (
                    <TD>
                      <TeamRowActions
                        team={{
                          id: t.id,
                          name: t.name,
                          branchId: t.branchId,
                          leadMembershipId: t.leadMembershipId,
                          isActive: t.isActive,
                        }}
                        lookups={lookups}
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
