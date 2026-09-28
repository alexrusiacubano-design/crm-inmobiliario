import {
  geoNames,
  getLead,
  listAssignees,
  listGeo,
  listTimeline,
  NotFoundError,
  ValidationError,
} from "@crm/core";
import { getDb } from "@crm/db";
import {
  formatMoney,
  LEAD_LOST_REASON_LABELS,
  LEAD_OPERATION_LABELS,
  LEAD_SOURCE_LABELS,
  money,
  PROPERTY_FEATURE_LABELS,
  PROPERTY_TYPE_LABELS,
  type Currency,
  type PropertyFeature,
  type PropertyType,
} from "@crm/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChannelIcon, LeadStatusBadge, channelHref } from "@/components/crm/badges";
import { LeadAssignControl, LeadStatusControl, LeadStepper } from "@/components/crm/lead-controls";
import { EditSearchButton, type SearchFormValues } from "@/components/crm/search-profile-form";
import { Timeline } from "@/components/crm/timeline";
import { Card } from "@/components/ui/misc";
import { requireSession } from "@/lib/session";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Lead" };

/** Unidad menor → texto editable ("230000" o "1234,50"), sin pasar por float. */
function minorToInput(v: bigint | null): string {
  if (v === null) return "";
  const cents = v % 100n;
  return cents === 0n ? (v / 100n).toString() : `${v / 100n},${cents.toString().padStart(2, "0")}`;
}

function range(min: bigint | null, max: bigint | null, currency: Currency): string {
  const f = (v: bigint) => formatMoney(money(v, currency));
  if (min !== null && max !== null) return `${f(min)} – ${f(max)}`;
  if (max !== null) return `hasta ${f(max)}`;
  if (min !== null) return `desde ${f(min)}`;
  return "Sin definir";
}

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requireSession();
  const { id } = await params;
  const db = getDb();
  const data = await getLead(db, ctx, id).catch((error: unknown) => {
    if (error instanceof NotFoundError || error instanceof ValidationError) notFound();
    throw error;
  });
  const { lead: l, contact: c, search: s, permissions } = data;
  const [timeline, assignees, geo, zones] = await Promise.all([
    listTimeline(db, ctx, { leadId: l.id }),
    permissions.assign ? listAssignees(db, ctx) : Promise.resolve([]),
    permissions.update ? listGeo(db) : Promise.resolve(null),
    s
      ? geoNames(db, {
          departmentIds: s.departmentIds,
          localityIds: s.localityIds,
          neighborhoodIds: s.neighborhoodIds,
        })
      : Promise.resolve(null),
  ]);

  const searchInitial: SearchFormValues | null = s && {
    operation: s.operation,
    propertyTypes: s.propertyTypes as PropertyType[],
    departmentIds: s.departmentIds,
    localityIds: s.localityIds,
    neighborhoodIds: s.neighborhoodIds,
    currency: s.currency,
    priceMin: minorToInput(s.priceMinMinor),
    priceMax: minorToInput(s.priceMaxMinor),
    bedroomsMin: s.bedroomsMin?.toString() ?? "",
    bathroomsMin: s.bathroomsMin?.toString() ?? "",
    garagesMin: s.garagesMin?.toString() ?? "",
    areaMin: s.areaMin?.toString() ?? "",
    commonExpensesMax: minorToInput(s.commonExpensesMaxMinor),
    commonExpensesCurrency: s.commonExpensesCurrency,
    pets: s.pets,
    furnished: s.furnished as SearchFormValues["furnished"],
    features: s.features as PropertyFeature[],
    targetDate: s.targetDate ?? "",
    notes: s.notes ?? "",
  };
  const zoneNames = zones
    ? [...zones.departments, ...zones.localities, ...zones.neighborhoods].map((z) => z.name)
    : [];

  const rows: [string, string][] = s
    ? [
        ["Operación", LEAD_OPERATION_LABELS[s.operation]],
        [
          "Tipo",
          s.propertyTypes.length
            ? s.propertyTypes.map((t) => PROPERTY_TYPE_LABELS[t as PropertyType]).join(", ")
            : "Indistinto",
        ],
        ["Zonas", zoneNames.length ? zoneNames.join(", ") : "Sin definir"],
        ["Precio", range(s.priceMinMinor, s.priceMaxMinor, s.currency)],
        [
          "Ambientes",
          [
            s.bedroomsMin !== null ? `${s.bedroomsMin}+ dorm.` : null,
            s.bathroomsMin !== null ? `${s.bathroomsMin}+ baños` : null,
            s.garagesMin !== null ? `${s.garagesMin}+ garaje` : null,
            s.areaMin !== null ? `${s.areaMin}+ m²` : null,
          ]
            .filter(Boolean)
            .join(" · ") || "Sin definir",
        ],
        [
          "Gastos comunes",
          s.commonExpensesMaxMinor !== null
            ? `hasta ${formatMoney(money(s.commonExpensesMaxMinor, s.commonExpensesCurrency))}`
            : "Sin definir",
        ],
        ["Mascotas", s.pets ? "Sí, necesita que acepten" : "No indicado"],
        ["Amueblado", s.furnished === "yes" ? "Sí" : s.furnished === "no" ? "No" : "Indistinto"],
        [
          "Características",
          s.features.length
            ? s.features.map((f) => PROPERTY_FEATURE_LABELS[f as PropertyFeature]).join(", ")
            : "—",
        ],
        [
          "Fecha objetivo",
          s.targetDate ? new Date(`${s.targetDate}T12:00:00`).toLocaleDateString("es-UY") : "—",
        ],
      ]
    : [];

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4 pb-5">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            <Link href="/crm/leads" className="hover:underline">
              Leads
            </Link>{" "}
            / <span className="font-mono">{l.code}</span>
          </p>
          <h1 className="mt-0.5 flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight">
            <Link href={`/crm/contacts/${c.id}`} className="hover:underline">
              {c.displayName}
            </Link>
            <LeadStatusBadge status={l.status} />
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {LEAD_OPERATION_LABELS[l.operation]} · {LEAD_SOURCE_LABELS[l.source]} · creado{" "}
            {formatDateTime(l.createdAt)}
            {l.status === "lost" && l.lostReason ? ` · Motivo: ${LEAD_LOST_REASON_LABELS[l.lostReason]}` : ""}
          </p>
        </div>
        {permissions.update && <LeadStatusControl leadId={l.id} status={l.status} />}
      </div>

      <div className="mb-5">
        <LeadStepper status={l.status} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
        <div className="grid content-start gap-5">
          <Card>
            <h2 className="border-b px-4 py-3 text-sm font-semibold">Contacto</h2>
            <div className="grid gap-3 p-4 text-sm">
              <ul className="grid gap-1.5">
                {c.channels.map((ch) => (
                  <li key={ch.id} className="flex items-center gap-2">
                    <ChannelIcon type={ch.type} className="size-3.5 text-muted-foreground" />
                    <a
                      href={channelHref(ch.type, ch.normalized)}
                      className="hover:underline"
                      target={ch.type === "whatsapp" ? "_blank" : undefined}
                      rel="noreferrer"
                    >
                      {ch.value}
                    </a>
                  </li>
                ))}
                {c.channels.length === 0 && <li className="text-muted-foreground">Sin datos de contacto</li>}
              </ul>
              <div>
                <p className="mb-1 text-xs text-muted-foreground">Responsable</p>
                {permissions.assign && assignees.length ? (
                  <LeadAssignControl leadId={l.id} assignedUserId={l.assignedUserId} assignees={assignees} />
                ) : (
                  <p>{data.assignedName ?? "Sin responsable"}</p>
                )}
              </div>
              {l.notes && (
                <div>
                  <p className="text-xs text-muted-foreground">Consulta inicial</p>
                  <p className="whitespace-pre-wrap">{l.notes}</p>
                </div>
              )}
            </div>
          </Card>

          <Card>
            <div className="flex items-center justify-between border-b px-4 py-2">
              <h2 className="text-sm font-semibold">Qué busca</h2>
              {permissions.update && searchInitial && geo && (
                <EditSearchButton leadId={l.id} initial={searchInitial} geo={geo} />
              )}
            </div>
            <dl className="divide-y text-sm">
              {rows.map(([k, v]) => (
                <div key={k} className="grid grid-cols-[8.5rem_1fr] gap-3 px-4 py-2">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">
              Las propiedades compatibles aparecen aquí cuando esté el matching (Fase 4).
            </p>
          </Card>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold">Timeline</h2>
          <Timeline
            initial={timeline.items.map((i) => ({ ...i, occurredAt: i.occurredAt.toISOString() }))}
            nextCursor={timeline.nextCursor}
            leadId={l.id}
            canLog={permissions.update}
          />
        </div>
      </div>
    </>
  );
}
