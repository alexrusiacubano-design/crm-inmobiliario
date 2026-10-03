import { listPublications } from "@crm/core";
import { getDb } from "@crm/db";
import { AD_LEVEL_LABELS, AD_LEVELS, PORTAL_LABELS, PORTALS, type Portal } from "@crm/shared/publications";
import { Megaphone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PublicationsTable } from "@/components/publications/publications-table";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { requirePagePermission } from "@/lib/session";
import { DEFAULT_TZ, ymdInTz } from "@/lib/tz";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Publicaciones" };

const TABS = [
  { key: "published", label: "Publicados" },
  { key: "alerts", label: "Requieren atención" },
  { key: "paused", label: "Pausados" },
  { key: "removed", label: "Dados de baja" },
  { key: "all", label: "Todos" },
] as const;

export default async function PublicationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { ctx } = await requirePagePermission("publication.read");
  const params = await searchParams;
  const status = TABS.some((t) => t.key === params.status)
    ? (params.status as (typeof TABS)[number]["key"])
    : "published";
  const portal = PORTALS.includes(params.portal as Portal) ? (params.portal as Portal) : undefined;
  const today = ymdInTz(new Date(), ctx.organization.timezone || DEFAULT_TZ);
  const r = await listPublications(getDb(), ctx, { status, portal, today });
  const chip = (active: boolean) =>
    cn(
      "rounded-full border px-3 py-1 text-xs",
      active ? "border-primary bg-primary-soft text-primary" : "text-muted-foreground hover:text-foreground",
    );
  const qs = (p: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    const next = { status, portal, ...p };
    for (const [k, v] of Object.entries(next)) if (v) q.set(k, v);
    return `?${q.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Publicaciones en portales"
        description="Avisos por portal con su nivel, vencimiento y rendimiento. Se publica desde la ficha de cada propiedad; los cupos y el feed se configuran en Administración → Integraciones."
      />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {r.portals.map((p) => (
          <Card key={p.portal} className={cn("p-4", !p.enabled && "opacity-60")}>
            <p className="flex items-center justify-between text-xs text-muted-foreground">
              {PORTAL_LABELS[p.portal]}
              {!p.enabled && <Badge tone="neutral">Inactivo</Badge>}
            </p>
            <p className="mt-1 text-2xl font-semibold tabular">{p.total}</p>
            <p className="text-xs text-muted-foreground">
              {AD_LEVELS.filter((l) => p.quotas[l] !== undefined || p.used[l])
                .map(
                  (l) =>
                    `${AD_LEVEL_LABELS[l]} ${p.used[l] ?? 0}${p.quotas[l] !== undefined ? `/${p.quotas[l]}` : ""}`,
                )
                .join(" · ") || "avisos publicados"}
            </p>
          </Card>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <Link key={t.key} href={qs({ status: t.key })} className={chip(status === t.key)}>
            {t.label}
          </Link>
        ))}
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <Link href={qs({ portal: undefined })} className={chip(!portal)}>
          Todos los portales
        </Link>
        {PORTALS.map((p) => (
          <Link key={p} href={qs({ portal: p })} className={chip(portal === p)}>
            {PORTAL_LABELS[p]}
          </Link>
        ))}
      </div>
      <Card>
        {r.items.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title="No hay avisos en esta vista"
            description="Publicá desde la ficha de la propiedad (pestaña Publicaciones)."
          />
        ) : (
          <PublicationsTable rows={r.items} canManage={r.canManage} />
        )}
      </Card>
    </>
  );
}
