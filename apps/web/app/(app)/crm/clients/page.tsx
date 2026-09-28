import { listContacts } from "@crm/core";
import { getDb } from "@crm/db";
import {
  LEAD_OPERATION_LABELS,
  LEAD_OPERATIONS,
  LEAD_SOURCE_LABELS,
  LEAD_SOURCES,
  type ClientState,
} from "@crm/shared";
import { Columns3, List, MessageCircle, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Pagination, SearchBox } from "@/components/data/list-controls";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requirePagePermission } from "@/lib/session";
import { cn, whatsappLink } from "@/lib/utils";

export const metadata: Metadata = { title: "Clientes" };

type Item = Awaited<ReturnType<typeof listContacts>>["items"][number];

const STATES: { key: ClientState; label: string }[] = [
  { key: "active", label: "Activos" },
  { key: "closed", label: "Cerrados" },
  { key: "discarded", label: "Descartados" },
  { key: "all", label: "Todos" },
];

const STATE_BADGE: Record<
  Exclude<ClientState, "all">,
  { label: string; tone: "primary" | "success" | "neutral" }
> = {
  active: { label: "Activo", tone: "primary" },
  closed: { label: "Cerrado", tone: "success" },
  discarded: { label: "Descartado", tone: "neutral" },
};

const COLUMN_TONE: Record<Exclude<ClientState, "all">, string> = {
  active: "border-t-primary",
  closed: "border-t-success",
  discarded: "border-t-muted-foreground",
};

const dateFmt = new Intl.DateTimeFormat("es-UY", { day: "numeric", month: "short", year: "numeric" });

function Phone({ phone }: { phone: string | null }) {
  if (!phone) return <span className="text-muted-foreground">—</span>;
  const wa = whatsappLink(phone);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap tabular">
      {wa && (
        <a
          href={wa}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Escribir por WhatsApp a ${phone}`}
          className="text-success hover:opacity-80"
        >
          <MessageCircle className="size-4" />
        </a>
      )}
      {phone}
    </span>
  );
}

function Tags({ c }: { c: Item }) {
  const tags = c.tags.filter((t) => t !== "Propietario").slice(0, 3);
  return (
    <>
      {c.isOwner && <Badge tone="success">Propietario</Badge>}
      {tags.map((t) => (
        <Link key={t} href={`/crm/contacts?tag=${encodeURIComponent(t)}`}>
          <Badge>{t}</Badge>
        </Link>
      ))}
    </>
  );
}

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { ctx } = await requirePagePermission("lead.read");
  const params = await searchParams;
  const db = getDb();
  const view = params.view === "board" ? "board" : "list";
  const state = (STATES.some((s) => s.key === params.state) ? params.state : "active") as ClientState;
  const base = { role: "client", q: params.q, source: params.source, operation: params.operation };

  const href = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...params, ...patch, page: undefined })) if (v) next.set(k, v);
    const s = next.toString();
    return s ? `?${s}` : "?";
  };

  const [list, board] = await Promise.all([
    view === "list" ? listContacts(db, ctx, { ...base, state, page: params.page }) : null,
    view === "board"
      ? Promise.all(
          (["active", "closed", "discarded"] as const).map(async (s) => ({
            state: s,
            ...(await listContacts(db, ctx, { ...base, state: s, pageSize: 30 })),
          })),
        )
      : null,
  ]);

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Compradores e inquilinos: contactos con al menos un lead. Los leads nuevos se cargan desde Leads."
      />

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2 p-3">
          <SearchBox placeholder="Nombre, teléfono, email o documento" className="max-w-sm" />
          <nav aria-label="Fuente" className="flex flex-wrap gap-1 text-xs">
            <Link
              href={href({ source: undefined })}
              className={cn(
                "rounded-full border px-2.5 py-1",
                !params.source ? "border-primary bg-primary-soft text-primary" : "text-muted-foreground",
              )}
            >
              Todas las fuentes
            </Link>
            {LEAD_SOURCES.map((s) => (
              <Link
                key={s}
                href={href({ source: s })}
                className={cn(
                  "rounded-full border px-2.5 py-1",
                  params.source === s
                    ? "border-primary bg-primary-soft text-primary"
                    : "text-muted-foreground hover:bg-surface-muted",
                )}
              >
                {LEAD_SOURCE_LABELS[s]}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <nav aria-label="Operación" className="flex rounded-md border p-0.5 text-xs">
              {[undefined, ...LEAD_OPERATIONS].map((op) => (
                <Link
                  key={op ?? "all"}
                  href={href({ operation: op })}
                  className={cn(
                    "rounded px-2 py-1",
                    params.operation === op ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                  )}
                >
                  {op ? LEAD_OPERATION_LABELS[op] : "Todas"}
                </Link>
              ))}
            </nav>
            <nav aria-label="Vista" className="flex rounded-md border p-0.5">
              <Link
                href={href({ view: undefined })}
                aria-label="Vista de lista"
                aria-current={view === "list" ? "page" : undefined}
                className={cn(
                  "rounded p-1.5",
                  view === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                )}
              >
                <List className="size-4" />
              </Link>
              <Link
                href={href({ view: "board", state: undefined })}
                aria-label="Vista de tablero"
                aria-current={view === "board" ? "page" : undefined}
                className={cn(
                  "rounded p-1.5",
                  view === "board" ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                )}
              >
                <Columns3 className="size-4" />
              </Link>
            </nav>
          </div>
        </div>
      </Card>

      {list && (
        <Card>
          <nav aria-label="Estado" className="flex gap-4 overflow-x-auto border-b px-4 text-sm">
            {STATES.map((s) => (
              <Link
                key={s.key}
                href={href({ state: s.key })}
                aria-current={state === s.key ? "page" : undefined}
                className={cn(
                  "-mb-px border-b-2 py-2.5 whitespace-nowrap",
                  state === s.key
                    ? "border-primary font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {s.label}
                {state === s.key && (
                  <span className="ml-1.5 text-muted-foreground tabular">{list.total}</span>
                )}
              </Link>
            ))}
          </nav>
          {list.items.length === 0 ? (
            <EmptyState
              icon={Users}
              title={params.q ? "Nada coincide con la búsqueda" : "No hay clientes en este estado"}
              description="Un contacto aparece acá cuando tiene al menos un lead."
            />
          ) : (
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Cliente</TH>
                  <TH className="hidden md:table-cell">Teléfono</TH>
                  <TH className="hidden lg:table-cell">Fuente</TH>
                  <TH>Estado</TH>
                  <TH className="hidden sm:table-cell">Responsable</TH>
                  <TH className="hidden xl:table-cell text-right">Registrado</TH>
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
                        <Tags c={c} />
                        <span className="text-xs text-muted-foreground md:hidden">{c.phone}</span>
                      </div>
                    </TD>
                    <TD className="hidden text-muted-foreground md:table-cell">
                      <Phone phone={c.phone} />
                    </TD>
                    <TD className="hidden text-muted-foreground lg:table-cell">
                      {c.lastSource ? LEAD_SOURCE_LABELS[c.lastSource] : "—"}
                      {c.lastOperation && (
                        <span className="block text-xs">{LEAD_OPERATION_LABELS[c.lastOperation]}</span>
                      )}
                    </TD>
                    <TD>
                      {c.clientState && (
                        <Badge tone={STATE_BADGE[c.clientState].tone}>
                          {STATE_BADGE[c.clientState].label}
                        </Badge>
                      )}
                      {c.openLeads > 1 && (
                        <span className="ml-1 text-xs text-muted-foreground">{c.openLeads} búsquedas</span>
                      )}
                    </TD>
                    <TD className="hidden text-muted-foreground sm:table-cell">{c.assignedName ?? "—"}</TD>
                    <TD className="hidden text-right text-muted-foreground tabular xl:table-cell">
                      {dateFmt.format(c.createdAt)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
          <Pagination page={list.page} pageSize={list.pageSize} total={list.total} />
        </Card>
      )}

      {board && (
        <div className="grid gap-4 lg:grid-cols-3">
          {board.map((col) => (
            <section
              key={col.state}
              className={cn("rounded-xl border border-t-4 bg-surface-muted/60 p-3", COLUMN_TONE[col.state])}
            >
              <header className="mb-3 flex items-center justify-between px-1">
                <h2 className="text-sm font-semibold">{STATE_BADGE[col.state].label}</h2>
                <Badge tone="outline">{col.total}</Badge>
              </header>
              {col.items.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Sin clientes</p>
              ) : (
                <ul className="grid max-h-[70vh] gap-2 overflow-y-auto pr-1">
                  {col.items.map((c) => (
                    <li key={c.id} className="rounded-lg border bg-surface p-3 shadow-xs">
                      <Link
                        href={`/crm/contacts/${c.id}`}
                        className="block truncate font-medium hover:underline"
                      >
                        {c.displayName}
                      </Link>
                      <div className="mt-1 text-sm text-muted-foreground">
                        <Phone phone={c.phone} />
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1">
                        {c.lastSource && <Badge tone="outline">{LEAD_SOURCE_LABELS[c.lastSource]}</Badge>}
                        <Tags c={c} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {col.total > col.items.length && (
                <Link
                  href={href({ view: undefined, state: col.state })}
                  className="mt-2 block text-center text-xs text-primary hover:underline"
                >
                  Ver los {col.total}
                </Link>
              )}
            </section>
          ))}
        </div>
      )}
    </>
  );
}
