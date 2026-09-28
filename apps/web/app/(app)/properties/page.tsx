import { hasPermission, listProperties, propertyStats } from "@crm/core";
import { getDb } from "@crm/db";
import {
  PROPERTY_OPERATION_LABELS,
  PROPERTY_OPERATIONS,
  PROPERTY_STATUS_LABELS,
  PROPERTY_STATUSES,
  PROPERTY_TYPE_LABELS,
  PROPERTY_TYPES,
  type PropertyStatus,
} from "@crm/shared";
import { Building2, ImageOff, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Pagination, SearchBox } from "@/components/data/list-controls";
import { PropertyStatusBadge } from "@/components/properties/badges";
import { price } from "@/components/properties/format";
import { PrivateImage } from "@/components/properties/private-image";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { requirePagePermission } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Propiedades" };

function href(params: Record<string, string | undefined>, patch: Record<string, string | undefined>) {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...patch, page: undefined })) if (v) next.set(k, v);
  const s = next.toString();
  return s ? `?${s}` : "?";
}

export default async function PropertiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { ctx } = await requirePagePermission("property.read");
  const params = await searchParams;
  const status = params.status ?? "active";
  const db = getDb();
  const [list, stats] = await Promise.all([
    listProperties(db, ctx, { ...params, status: status === "all" ? undefined : status, pageSize: 24 }),
    propertyStats(db, ctx),
  ]);
  const counts = stats ?? {};
  const activeTotal = (["available", "published", "negotiating", "reserved"] as PropertyStatus[]).reduce(
    (acc, s) => acc + (counts[s] ?? 0),
    0,
  );
  const allTotal = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
  const tabs = [
    { key: "active", label: "Activas", n: activeTotal },
    ...PROPERTY_STATUSES.map((s) => ({ key: s, label: PROPERTY_STATUS_LABELS[s], n: counts[s] ?? 0 })).filter(
      (t) => t.n > 0 || ["draft", "published"].includes(t.key),
    ),
    { key: "all", label: "Todas", n: allTotal },
  ];

  return (
    <>
      <PageHeader
        title="Propiedades"
        description="Inventario de la inmobiliaria. Todos los agentes ven el inventario; cada uno edita las suyas."
        actions={
          hasPermission(ctx, "property.create") ? (
            <Button asChild>
              <Link href="/properties/new">
                <Plus /> Nueva propiedad
              </Link>
            </Button>
          ) : undefined
        }
      />
      <Card>
        <nav aria-label="Estados" className="flex gap-1 overflow-x-auto border-b px-2">
          {tabs.map((t) => (
            <Link
              key={t.key}
              href={href(params, { status: t.key })}
              aria-current={status === t.key ? "page" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2.5 text-sm",
                status === t.key
                  ? "border-primary font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              <span className="rounded bg-surface-muted px-1 text-xs tabular">{t.n}</span>
            </Link>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <div className="min-w-56 flex-1">
            <SearchBox placeholder="Código PROP-…, título, dirección o barrio" />
          </div>
          <nav aria-label="Operación" className="flex flex-wrap gap-1 text-sm">
            {[undefined, ...PROPERTY_OPERATIONS].map((op) => (
              <Link
                key={op ?? "any"}
                href={href(params, { operation: op })}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs",
                  params.operation === op
                    ? "border-primary bg-primary-soft font-medium text-primary"
                    : "text-muted-foreground hover:bg-surface-muted",
                )}
              >
                {op ? PROPERTY_OPERATION_LABELS[op] : "Todas las operaciones"}
              </Link>
            ))}
          </nav>
          <nav aria-label="Tipo" className="flex flex-wrap gap-1 text-sm">
            {PROPERTY_TYPES.slice(0, 5).map((t) => (
              <Link
                key={t}
                href={href(params, { type: params.type === t ? undefined : t })}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs",
                  params.type === t
                    ? "border-primary bg-primary-soft font-medium text-primary"
                    : "text-muted-foreground hover:bg-surface-muted",
                )}
              >
                {PROPERTY_TYPE_LABELS[t]}
              </Link>
            ))}
          </nav>
        </div>
        {list.items.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="No hay propiedades con estos filtros"
            description={
              params.q ? "Probá con otra búsqueda." : "Creá una propiedad o captala desde una captación."
            }
          />
        ) : (
          <ul className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3">
            {list.items.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/properties/${p.id}`}
                  className="group flex h-full flex-col overflow-hidden rounded-lg border bg-surface transition-colors hover:border-border-strong"
                >
                  <div className="relative aspect-[16/10] bg-surface-muted">
                    {p.coverMediaId ? (
                      <PrivateImage mediaId={p.coverMediaId} alt={p.displayTitle} />
                    ) : (
                      <div className="flex size-full items-center justify-center text-muted-foreground">
                        <ImageOff className="size-6" aria-hidden />
                      </div>
                    )}
                    <div className="absolute left-2 top-2">
                      <PropertyStatusBadge status={p.status} />
                    </div>
                  </div>
                  <div className="grid flex-1 content-start gap-1 p-3">
                    <p className="text-xs text-muted-foreground">
                      <span className="font-mono">{p.code}</span> · {PROPERTY_TYPE_LABELS[p.type]}
                    </p>
                    <p className="line-clamp-2 font-medium group-hover:underline">{p.displayTitle}</p>
                    <p className="text-xs text-muted-foreground">
                      {[p.neighborhoodName, p.localityName].filter(Boolean).join(", ") || "Sin ubicación"}
                      {p.bedrooms !== null ? ` · ${p.bedrooms} dorm.` : ""}
                      {p.builtArea ? ` · ${p.builtArea.replace(/\.00$/, "")} m²` : ""}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-sm">
                      {p.prices.length === 0 ? (
                        <span className="text-muted-foreground">Sin precio</span>
                      ) : (
                        p.prices.map((pr) => (
                          <span key={pr.operation} className="tabular">
                            <span className="text-xs text-muted-foreground">
                              {PROPERTY_OPERATION_LABELS[pr.operation]}{" "}
                            </span>
                            <strong className="font-semibold">{price(pr.listMinor, pr.currency)}</strong>
                          </span>
                        ))
                      )}
                    </div>
                    <p className="mt-auto pt-1 text-xs text-muted-foreground">
                      {p.assignedName ?? "Sin responsable"}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Pagination page={list.page} pageSize={list.pageSize} total={list.total} />
      </Card>
    </>
  );
}
