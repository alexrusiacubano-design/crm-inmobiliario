import { expiringExclusivities, hasPermission, listAcquisitions, listAssignees, listGeo } from "@crm/core";
import { getDb } from "@crm/db";
import {
  ACQUISITION_STAGE_LABELS,
  ACQUISITION_STAGES,
  OPEN_ACQUISITION_STAGES,
  PROPERTY_OPERATION_LABELS,
  PROPERTY_TYPE_LABELS,
} from "@crm/shared";
import { CalendarClock, Handshake } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Pagination, SearchBox } from "@/components/data/list-controls";
import { AcquisitionDialogButton } from "@/components/properties/acquisition-dialog";
import { emptyAcquisition } from "@/components/properties/form-defaults";
import { AcquisitionStageBadge } from "@/components/properties/badges";
import { daysUntil, formatDay, price } from "@/components/properties/format";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requirePagePermission } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Captaciones" };

function href(params: Record<string, string | undefined>, patch: Record<string, string | undefined>) {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...patch, page: undefined })) if (v) next.set(k, v);
  const s = next.toString();
  return s ? `?${s}` : "?";
}

export default async function AcquisitionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { ctx } = await requirePagePermission("acquisition.read");
  const params = await searchParams;
  const stage = params.stage ?? "open";
  const db = getDb();
  const canManage = hasPermission(ctx, "acquisition.manage");
  const [list, expiring, geo, assignees] = await Promise.all([
    listAcquisitions(db, ctx, { ...params, stage: stage === "all" ? undefined : stage }),
    expiringExclusivities(db, ctx, 30),
    canManage ? listGeo(db) : Promise.resolve(null),
    canManage && hasPermission(ctx, "lead.assign") ? listAssignees(db, ctx) : Promise.resolve(undefined),
  ]);
  const counts = list.byStage;
  const openTotal = OPEN_ACQUISITION_STAGES.reduce((a, s) => a + (counts[s] ?? 0), 0);
  const tabs = [
    { key: "open", label: "Abiertas", n: openTotal },
    ...ACQUISITION_STAGES.map((s) => ({ key: s, label: ACQUISITION_STAGE_LABELS[s], n: counts[s] ?? 0 })),
    { key: "all", label: "Todas", n: Object.values(counts).reduce((a, b) => a + (b ?? 0), 0) },
  ];
  const montevideo = geo?.departments.find((d) => d.name === "Montevideo");

  return (
    <>
      <PageHeader
        title="Captaciones"
        description="Pipeline de propietarios: Prospecto → Contactado → Tasación → Negociación → Autorización → Captado → Publicado."
        actions={
          canManage && geo ? (
            <AcquisitionDialogButton
              initial={emptyAcquisition(montevideo ? String(montevideo.id) : "")}
              geo={geo}
              assignees={assignees}
            />
          ) : undefined
        }
      />
      {expiring.length > 0 && (
        <div
          role="status"
          className="mb-4 rounded-md border border-warning/40 bg-warning-soft px-4 py-2.5 text-sm"
        >
          <p className="flex items-center gap-2 font-medium">
            <CalendarClock className="size-4" aria-hidden /> Exclusividades que vencen en 30 días
          </p>
          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {expiring.map((e) => (
              <li key={e.id}>
                <Link href={`/properties/acquisitions/${e.id}`} className="font-mono hover:underline">
                  {e.code}
                </Link>{" "}
                <span className="text-muted-foreground">
                  {formatDay(e.exclusiveUntil)} ({e.exclusiveUntil ? daysUntil(e.exclusiveUntil) : "?"} días)
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Card>
        <nav aria-label="Etapas" className="flex gap-1 overflow-x-auto border-b px-2">
          {tabs.map((t) => (
            <Link
              key={t.key}
              href={href(params, { stage: t.key })}
              aria-current={stage === t.key ? "page" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2.5 text-sm",
                stage === t.key
                  ? "border-primary font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              <span className="rounded bg-surface-muted px-1 text-xs tabular">{t.n}</span>
            </Link>
          ))}
        </nav>
        <div className="border-b p-3">
          <SearchBox placeholder="Código CAP-…, propietario o dirección" />
        </div>
        {list.items.length === 0 ? (
          <EmptyState
            icon={Handshake}
            title="No hay captaciones en esta etapa"
            description={params.q ? "Probá con otra búsqueda." : undefined}
          />
        ) : (
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Propietario</TH>
                <TH className="hidden sm:table-cell">Inmueble</TH>
                <TH>Etapa</TH>
                <TH className="hidden text-right md:table-cell">Pide / recomendado</TH>
                <TH className="hidden lg:table-cell">Captador</TH>
              </TR>
            </THead>
            <TBody>
              {list.items.map((a) => (
                <TR key={a.id}>
                  <TD>
                    <Link href={`/properties/acquisitions/${a.id}`} className="font-medium hover:underline">
                      {a.ownerName}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-mono">{a.code}</span>
                    </p>
                  </TD>
                  <TD className="hidden sm:table-cell">
                    {PROPERTY_TYPE_LABELS[a.propertyType]} · {PROPERTY_OPERATION_LABELS[a.operation]}
                    <p className="text-xs text-muted-foreground">{a.zone || a.address || "—"}</p>
                  </TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      <AcquisitionStageBadge stage={a.stage} />
                      {a.exclusive && <Badge tone="outline">Exclusiva</Badge>}
                    </div>
                  </TD>
                  <TD className="hidden text-right tabular md:table-cell">
                    {price(a.askingMinor, a.currency)}
                    <p className="text-xs text-muted-foreground">{price(a.recommendedMinor, a.currency)}</p>
                  </TD>
                  <TD className="hidden text-muted-foreground lg:table-cell">{a.captadorName ?? "—"}</TD>
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
