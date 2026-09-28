import { listDocuments } from "@crm/core";
import { getDb } from "@crm/db";
import { DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABELS } from "@crm/shared";
import { Download, FileText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Pagination, SearchBox } from "@/components/data/list-controls";
import { DocumentStatusBadge, VisibilityBadge } from "@/components/properties/badges";
import { daysUntil, formatBytes, formatDay } from "@/components/properties/format";
import { Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requirePagePermission } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Documentos" };

function href(params: Record<string, string | undefined>, patch: Record<string, string | undefined>) {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...patch, page: undefined })) if (v) next.set(k, v);
  const s = next.toString();
  return s ? `?${s}` : "?";
}

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { ctx } = await requirePagePermission("document.read");
  const params = await searchParams;
  const list = await listDocuments(getDb(), ctx, params);
  const chip = (active: boolean) =>
    cn(
      "rounded-full border px-2.5 py-1 text-xs",
      active
        ? "border-primary bg-primary-soft font-medium text-primary"
        : "text-muted-foreground hover:bg-surface-muted",
    );

  return (
    <>
      <PageHeader
        title="Documentos"
        description="Expediente documental de propiedades y contactos. Se cargan desde cada ficha; aquí se ven todos los que tu rol puede consultar."
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <div className="min-w-56 flex-1">
            <SearchBox placeholder="Nombre o tipo de documento" />
          </div>
          <nav aria-label="Categoría" className="flex flex-wrap gap-1">
            <Link href={href(params, { category: undefined })} className={chip(!params.category)}>
              Todas
            </Link>
            {DOCUMENT_CATEGORIES.map((c) => (
              <Link key={c} href={href(params, { category: c })} className={chip(params.category === c)}>
                {DOCUMENT_CATEGORY_LABELS[c]}
              </Link>
            ))}
          </nav>
          <Link
            href={href(params, { expiring: params.expiring === "1" ? undefined : "1" })}
            className={chip(params.expiring === "1")}
          >
            Vencen en 30 días o vencidos
          </Link>
        </div>
        {list.items.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No hay documentos"
            description="Se cargan desde la ficha de una propiedad o de un contacto."
          />
        ) : (
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Documento</TH>
                <TH className="hidden sm:table-cell">Vinculado a</TH>
                <TH>Estado</TH>
                <TH className="hidden md:table-cell">Vence</TH>
                <TH className="w-10">
                  <span className="sr-only">Descargar</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {list.items.map((d) => {
                const days = d.expiresAt ? daysUntil(d.expiresAt) : null;
                return (
                  <TR key={d.id}>
                    <TD>
                      <a
                        href={`/api/documents/${d.id}?inline=1`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium hover:underline"
                      >
                        {d.name}
                      </a>
                      <p className="text-xs text-muted-foreground">
                        {d.type} · {DOCUMENT_CATEGORY_LABELS[d.category]} · {formatBytes(d.sizeBytes)}
                      </p>
                    </TD>
                    <TD className="hidden sm:table-cell">
                      {d.entity.href ? (
                        <Link href={d.entity.href} className="hover:underline">
                          {d.entity.label}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">{d.entity.label}</span>
                      )}
                    </TD>
                    <TD>
                      <div className="flex flex-wrap gap-1">
                        <DocumentStatusBadge status={d.status} />
                        <VisibilityBadge visibility={d.visibility} />
                      </div>
                    </TD>
                    <TD
                      className={cn(
                        "hidden whitespace-nowrap md:table-cell",
                        days !== null && days < 0
                          ? "text-danger"
                          : days !== null && days <= 30
                            ? "text-warning"
                            : "text-muted-foreground",
                      )}
                    >
                      {formatDay(d.expiresAt)}
                    </TD>
                    <TD>
                      <a
                        href={`/api/documents/${d.id}`}
                        aria-label={`Descargar ${d.name}`}
                        className="inline-flex size-8 items-center justify-center rounded-md hover:bg-surface-muted"
                      >
                        <Download className="size-4" aria-hidden />
                      </a>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
        <Pagination page={list.page} pageSize={list.pageSize} total={list.total} />
      </Card>
    </>
  );
}
