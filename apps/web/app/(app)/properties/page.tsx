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
import {
  Bath,
  BedDouble,
  Building2,
  Car,
  ImageOff,
  LayoutGrid,
  List,
  MapPin,
  Plus,
  Ruler,
} from "lucide-react";
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
  const view = params.view === "list" ? "list" : "grid";
  const db = getDb();
  // «Mis propiedades» (asignadas a mí) o la «Bolsa» (todo el inventario de la inmobiliaria).
  const mineCount = (
    await listProperties(db, ctx, { status: "active", assignedUserId: ctx.userId, page: 1, pageSize: 5 })
  ).total;
  const scope =
    params.scope === "mine" || params.scope === "bolsa" ? params.scope : mineCount ? "mine" : "bolsa";
  const [list, stats] = await Promise.all([
    listProperties(db, ctx, {
      ...params,
      status: status === "all" ? undefined : status,
      assignedUserId: scope === "mine" ? ctx.userId : params.assignedUserId,
      pageSize: 24,
    }),
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
        title={scope === "mine" ? "Mis propiedades" : "Bolsa de propiedades"}
        description={
          scope === "mine"
            ? `${mineCount} propiedad${mineCount === 1 ? "" : "es"} activa${mineCount === 1 ? "" : "s"} asignada${mineCount === 1 ? "" : "s"} a vos.`
            : "Todo el inventario de la inmobiliaria. Las de otros agentes se ven en modo lectura: coordiná con su responsable."
        }
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
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Inventario" className="flex rounded-xl border bg-surface p-1 text-sm">
          {(
            [
              ["mine", "Mis propiedades"],
              ["bolsa", "Bolsa de propiedades"],
            ] as const
          ).map(([k, label]) => (
            <Link
              key={k}
              href={href(params, { scope: k, assignedUserId: undefined })}
              aria-current={scope === k ? "page" : undefined}
              className={cn(
                "rounded-lg px-3 py-1.5",
                scope === k
                  ? "bg-primary-soft font-medium text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
        <nav aria-label="Vista" className="flex rounded-xl border bg-surface p-1">
          {(
            [
              ["grid", LayoutGrid, "Tarjetas"],
              ["list", List, "Lista"],
            ] as const
          ).map(([k, Icon, label]) => (
            <Link
              key={k}
              href={href(params, { view: k === "grid" ? undefined : k })}
              aria-label={label}
              title={label}
              className={cn(
                "flex size-8 items-center justify-center rounded-lg",
                view === k ? "bg-primary-soft text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
            </Link>
          ))}
        </nav>
      </div>
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
        ) : view === "grid" ? (
          <ul className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {list.items.map((p) => {
              const mine = p.assignedUserId === ctx.userId;
              return (
                <li key={p.id}>
                  <Link
                    href={`/properties/${p.id}`}
                    className="group flex h-full flex-col overflow-hidden rounded-xl border bg-surface transition hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg"
                  >
                    <div className="relative aspect-[4/3] overflow-hidden bg-surface-muted">
                      {p.coverMediaId ? (
                        <PrivateImage
                          mediaId={p.coverMediaId}
                          alt={p.displayTitle}
                          className="transition duration-500 group-hover:scale-[1.04]"
                        />
                      ) : (
                        <div className="flex size-full items-center justify-center text-muted-foreground">
                          <ImageOff className="size-6" aria-hidden />
                        </div>
                      )}
                      <div className="absolute top-2 left-2 flex flex-wrap gap-1">
                        {p.prices.map((pr) => (
                          <span
                            key={pr.operation}
                            className="rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white uppercase backdrop-blur"
                          >
                            {PROPERTY_OPERATION_LABELS[pr.operation]}
                          </span>
                        ))}
                      </div>
                      {p.isExclusive && (
                        <span className="absolute top-2 right-2 rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground uppercase">
                          Exclusiva
                        </span>
                      )}
                    </div>
                    <div className="grid flex-1 content-start gap-1.5 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <PropertyStatusBadge status={p.status} />
                        <span className="rounded-md border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          {PROPERTY_TYPE_LABELS[p.type]}
                        </span>
                      </div>
                      <p className="line-clamp-2 text-sm font-semibold group-hover:underline">
                        {p.displayTitle}
                      </p>
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="size-3.5 shrink-0" />
                        <span className="truncate">
                          {[p.neighborhoodName, p.localityName].filter(Boolean).join(", ") || "Sin ubicación"}
                        </span>
                      </p>
                      <div className="flex flex-wrap gap-x-3 text-sm">
                        {p.prices.length === 0 ? (
                          <span className="text-muted-foreground">Sin precio</span>
                        ) : (
                          p.prices.map((pr) => (
                            <strong key={pr.operation} className="font-semibold text-primary tabular">
                              {price(pr.listMinor, pr.currency)}
                              {pr.operation !== "sale" && <span className="text-xs font-normal">/mes</span>}
                            </strong>
                          ))
                        )}
                      </div>
                      <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                        {p.bedrooms !== null && (
                          <span className="flex items-center gap-1">
                            <BedDouble className="size-3.5" /> {p.bedrooms}
                          </span>
                        )}
                        {p.bathrooms !== null && (
                          <span className="flex items-center gap-1">
                            <Bath className="size-3.5" /> {p.bathrooms}
                          </span>
                        )}
                        {p.garages ? (
                          <span className="flex items-center gap-1">
                            <Car className="size-3.5" /> {p.garages}
                          </span>
                        ) : null}
                        {(p.builtArea || p.totalArea) && (
                          <span className="flex items-center gap-1">
                            <Ruler className="size-3.5" />{" "}
                            {(p.builtArea ?? p.totalArea ?? "").replace(/\.00$/, "")} m²
                          </span>
                        )}
                      </p>
                      <p className="mt-auto flex items-center justify-between gap-2 border-t pt-2 text-[11px] text-muted-foreground">
                        <span className="font-mono">{p.code}</span>
                        <span className="truncate">
                          {mine ? "Tuya" : (p.assignedName ?? "Sin responsable")}
                        </span>
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Propiedad</th>
                  <th className="px-3 py-2 font-medium">Estado</th>
                  <th className="px-3 py-2 font-medium">Ubicación</th>
                  <th className="px-3 py-2 text-right font-medium">Precio</th>
                  <th className="px-3 py-2 font-medium">Responsable</th>
                </tr>
              </thead>
              <tbody>
                {list.items.map((p) => (
                  <tr key={p.id} className="border-b last:border-0 hover:bg-surface-muted">
                    <td className="px-3 py-2">
                      <Link href={`/properties/${p.id}`} className="flex items-center gap-3">
                        <span className="relative size-11 shrink-0 overflow-hidden rounded-lg bg-surface-muted">
                          {p.coverMediaId ? (
                            <PrivateImage mediaId={p.coverMediaId} alt={p.displayTitle} />
                          ) : (
                            <ImageOff className="m-auto mt-3 size-4 text-muted-foreground" />
                          )}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium hover:underline">{p.displayTitle}</span>
                          <span className="text-xs text-muted-foreground">
                            <span className="font-mono">{p.code}</span> · {PROPERTY_TYPE_LABELS[p.type]}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <PropertyStatusBadge status={p.status} />
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {[p.neighborhoodName, p.localityName].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap tabular">
                      {p.prices.length
                        ? p.prices.map((pr) => (
                            <span key={pr.operation} className="block">
                              {price(pr.listMinor, pr.currency)}
                            </span>
                          ))
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {p.assignedUserId === ctx.userId ? "Vos" : (p.assignedName ?? "—")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={list.page} pageSize={list.pageSize} total={list.total} />
      </Card>
    </>
  );
}
