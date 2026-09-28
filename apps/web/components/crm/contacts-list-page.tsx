import { hasPermission, listAssignees, listContacts, type RequestContext } from "@crm/core";
import { getDb } from "@crm/db";
import { Building, Copy, Users } from "lucide-react";
import Link from "next/link";
import { Pagination, SearchBox } from "@/components/data/list-controls";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { NewContactButton } from "./contact-dialog";

export async function ContactsListPage({
  ctx,
  role,
  title,
  description,
  params,
}: {
  ctx: RequestContext;
  role: "all" | "client" | "owner";
  title: string;
  description: string;
  params: Record<string, string | undefined>;
}) {
  const db = getDb();
  const list = await listContacts(db, ctx, { ...params, role });
  const canCreate = hasPermission(ctx, "contact.create");
  const assignees = hasPermission(ctx, "lead.assign") ? await listAssignees(db, ctx) : undefined;
  const canMerge = hasPermission(ctx, "contact.merge");

  return (
    <>
      <PageHeader
        title={title}
        description={description}
        actions={
          <>
            {canMerge && role === "all" && (
              <Button variant="secondary" asChild>
                <Link href="/crm/contacts/duplicates">
                  <Copy /> Duplicados
                </Link>
              </Button>
            )}
            {canCreate && role !== "client" && (
              <NewContactButton
                assignees={assignees}
                label={role === "owner" ? "Nuevo propietario" : "Nuevo contacto"}
                initialTags={role === "owner" ? "Propietario" : ""}
              />
            )}
          </>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <SearchBox placeholder="Nombre, teléfono, email o documento" className="max-w-sm" />
          {params.tag && (
            <Badge tone="primary">
              Etiqueta: {params.tag}{" "}
              <Link href="?" className="ml-1 underline">
                quitar
              </Link>
            </Badge>
          )}
        </div>
        {list.items.length === 0 ? (
          <EmptyState
            icon={role === "owner" ? Building : Users}
            title={
              params.q
                ? "Nada coincide con la búsqueda"
                : role === "client"
                  ? "No hay clientes con búsquedas abiertas"
                  : role === "owner"
                    ? "Todavía no hay propietarios"
                    : "Todavía no hay contactos"
            }
            description={
              role === "owner"
                ? "Un contacto pasa a ser propietario cuando registrás sus datos de propietario desde su ficha."
                : role === "client"
                  ? "Aparecen aquí los contactos con al menos un lead abierto."
                  : "Creá un contacto o cargá un lead: el contacto se crea con él."
            }
          />
        ) : (
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Nombre</TH>
                <TH className="hidden md:table-cell">Teléfono</TH>
                <TH className="hidden lg:table-cell">Email</TH>
                <TH className="hidden sm:table-cell">Responsable</TH>
                <TH className="text-right">Leads abiertos</TH>
              </TR>
            </THead>
            <TBody>
              {list.items.map((c) => (
                <TR key={c.id}>
                  <TD className="max-w-0 sm:max-w-none">
                    <Link href={`/crm/contacts/${c.id}`} className="font-medium hover:underline">
                      {c.displayName}
                    </Link>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1">
                      {c.kind === "company" && <Badge tone="outline">Empresa</Badge>}
                      {c.isOwner && <Badge tone="success">Propietario</Badge>}
                      {c.tags
                        .filter((t) => t !== "Propietario")
                        .slice(0, 3)
                        .map((t) => (
                          <Link key={t} href={`?tag=${encodeURIComponent(t)}`}>
                            <Badge>{t}</Badge>
                          </Link>
                        ))}
                      <span className="text-xs text-muted-foreground md:hidden">{c.phone}</span>
                    </div>
                  </TD>
                  <TD className="hidden whitespace-nowrap text-muted-foreground tabular md:table-cell">
                    {c.phone ?? "—"}
                  </TD>
                  <TD className="hidden text-muted-foreground lg:table-cell">{c.email ?? "—"}</TD>
                  <TD className="hidden text-muted-foreground sm:table-cell">{c.assignedName ?? "—"}</TD>
                  <TD className="text-right tabular">{c.openLeads || "—"}</TD>
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
