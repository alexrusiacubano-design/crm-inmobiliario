import { hasPermission, listBranches, listMembers, listRoles, listTeams, SUPER_ADMIN_KEY } from "@crm/core";
import { getDb } from "@crm/db";
import { ShieldCheck, Users } from "lucide-react";
import type { Metadata } from "next";
import { Pagination, SearchBox } from "@/components/data/list-controls";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requirePagePermission } from "@/lib/session";
import { initials } from "@/lib/utils";
import { UserRowActions } from "./row-actions";
import { EditUserButton, NewUserButton, type UserFormLookups } from "./user-form";

export const metadata: Metadata = { title: "Usuarios" };

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { ctx } = await requirePagePermission("users.read");
  const params = await searchParams;
  const db = getDb();
  const canManage = hasPermission(ctx, "users.manage");

  const [list, roles, branches, teams] = await Promise.all([
    listMembers(db, ctx, { q: params.q, page: params.page }),
    canManage ? listRoles(db, ctx) : Promise.resolve([]),
    canManage ? listBranches(db, ctx) : Promise.resolve([]),
    canManage ? listTeams(db, ctx) : Promise.resolve([]),
  ]);

  const lookups: UserFormLookups = {
    roles: roles.map((r) => ({ id: r.id, name: r.name, isLocked: r.isLocked, description: r.description })),
    branches: branches.filter((b) => b.isActive).map((b) => ({ id: b.id, name: b.name })),
    teams: teams.filter((t) => t.isActive).map((t) => ({ id: t.id, name: t.name, branchName: t.branchName })),
    canAssignLocked: ctx.roleKeys.includes(SUPER_ADMIN_KEY),
  };

  return (
    <>
      <PageHeader
        title="Usuarios"
        description="Quién accede al CRM, con qué roles y en qué sucursales y equipos."
        actions={canManage ? <NewUserButton lookups={lookups} /> : undefined}
      />
      <Card>
        <div className="flex items-center gap-3 border-b p-3">
          <SearchBox placeholder="Buscar por nombre o email" />
        </div>
        {list.items.length === 0 ? (
          <EmptyState
            icon={Users}
            title={params.q ? "Ningún usuario coincide con la búsqueda" : "Todavía no hay usuarios"}
            description={params.q ? "Probá con otro nombre o email." : undefined}
          />
        ) : (
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Usuario</TH>
                <TH className="hidden sm:table-cell">Roles</TH>
                <TH className="hidden md:table-cell">Sucursal</TH>
                <TH className="hidden lg:table-cell">Equipos</TH>
                <TH className="hidden sm:table-cell">Estado</TH>
                {canManage && <TH className="w-20 text-right">Acciones</TH>}
              </TR>
            </THead>
            <TBody>
              {list.items.map((m) => (
                <TR key={m.membershipId}>
                  <TD className="max-w-0 sm:max-w-none">
                    <div className="flex items-center gap-3">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold text-muted-foreground">
                        {initials(m.name)}
                      </span>
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 truncate font-medium">
                          {m.name}
                          {m.twoFactorEnabled && (
                            <ShieldCheck className="size-3.5 text-success" aria-label="2FA activo" />
                          )}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {m.email}
                          {m.jobTitle ? ` · ${m.jobTitle}` : ""}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-1 sm:hidden">
                          {m.roles.map((r) => (
                            <Badge key={r} tone="primary">
                              {r}
                            </Badge>
                          ))}
                          {m.status !== "active" && <Badge tone="danger">Suspendido</Badge>}
                        </div>
                      </div>
                    </div>
                  </TD>
                  <TD className="hidden sm:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {m.roles.map((r) => (
                        <Badge key={r} tone="primary">
                          {r}
                        </Badge>
                      ))}
                    </div>
                  </TD>
                  <TD className="hidden text-muted-foreground md:table-cell">{m.branchName ?? "—"}</TD>
                  <TD className="hidden text-muted-foreground lg:table-cell">{m.teams.join(", ") || "—"}</TD>
                  <TD className="hidden sm:table-cell">
                    <Badge tone={m.status === "active" ? "success" : "danger"}>
                      {m.status === "active" ? "Activo" : "Suspendido"}
                    </Badge>
                  </TD>
                  {canManage && (
                    <TD>
                      <div className="flex justify-end gap-0.5">
                        <EditUserButton membershipId={m.membershipId} lookups={lookups} />
                        <UserRowActions
                          membershipId={m.membershipId}
                          name={m.name}
                          status={m.status}
                          isSelf={m.membershipId === ctx.membershipId}
                        />
                      </div>
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        <Pagination page={list.page} pageSize={list.pageSize} total={list.total} />
      </Card>
    </>
  );
}
