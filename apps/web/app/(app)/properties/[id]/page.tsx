import {
  getProperty,
  listEntityDocuments,
  listPriceHistory,
  listPropertyHistory,
  listValuationsFor,
  NotFoundError,
  ValidationError,
} from "@crm/core";
import { getDb } from "@crm/db";
import {
  EXPENSE_KIND_LABELS,
  EXPENSE_PERIOD_LABELS,
  formatBasisPoints,
  ORIENTATION_LABELS,
  PRICE_FIELD_LABELS,
  PROPERTY_CONDITION_LABELS,
  PROPERTY_FEATURE_LABELS,
  PROPERTY_OPERATION_LABELS,
  PROPERTY_STATUS_LABELS,
  PROPERTY_TYPE_LABELS,
  type Orientation,
  type PriceField,
  type PropertyCondition,
  type PropertyFeature,
  type PropertyStatus,
} from "@crm/shared";
import { CheckCircle2, CircleAlert, ImageOff, Lock, Pencil } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AcquisitionStageBadge, PropertyStatusBadge } from "@/components/properties/badges";
import { DocumentsPanel } from "@/components/properties/documents-panel";
import { formatDay, minorToInput, price } from "@/components/properties/format";
import { MediaManager } from "@/components/properties/media-manager";
import { OwnersEditor } from "@/components/properties/owners-editor";
import { PricesEditor } from "@/components/properties/prices-editor";
import { PrivateImage } from "@/components/properties/private-image";
import { PropertyStatusControl } from "@/components/properties/status-control";
import { NewValuationButton } from "@/components/properties/valuation-dialog";
import { ValuationList } from "@/components/properties/valuation-list";
import { Button } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { auditActionLabel } from "@/lib/audit-labels";
import { requireSession } from "@/lib/session";
import { cn, formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Propiedad" };

const TABS = [
  { key: "summary", label: "Resumen" },
  { key: "media", label: "Fotos y videos" },
  { key: "prices", label: "Precios" },
  { key: "valuations", label: "Tasaciones" },
  { key: "documents", label: "Documentos" },
  { key: "history", label: "Historial" },
  { key: "matches", label: "Clientes compatibles", phase: 4 },
  { key: "visits", label: "Visitas", phase: 5 },
  { key: "offers", label: "Ofertas", phase: 6 },
] as const;

export default async function PropertyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { ctx } = await requireSession();
  const { id } = await params;
  const { tab = "summary" } = await searchParams;
  const db = getDb();
  const data = await getProperty(db, ctx, id).catch((error: unknown) => {
    if (error instanceof NotFoundError || error instanceof ValidationError) notFound();
    throw error;
  });
  const { property: p, permissions: can } = data;

  const [priceHistory, history, documents, valuations] = await Promise.all([
    tab === "prices" ? listPriceHistory(db, ctx, p.id) : Promise.resolve(null),
    tab === "history" ? listPropertyHistory(db, ctx, p.id) : Promise.resolve(null),
    tab === "documents" ? listEntityDocuments(db, ctx, "property", p.id) : Promise.resolve(null),
    tab === "valuations" ? listValuationsFor(db, ctx, { propertyId: p.id }) : Promise.resolve(null),
  ]);

  const cover = data.media.find((m) => m.isCover);
  // "Pocitos, Montevideo" (sin repetir cuando la localidad se llama igual que el departamento).
  const zone = [...new Set([data.zone.neighborhood, data.zone.locality, data.zone.department])]
    .filter(Boolean)
    .join(", ");
  const facts: [string, string][] = [
    ["Tipo", PROPERTY_TYPE_LABELS[p.type]],
    ["Operaciones", p.operations.map((o) => PROPERTY_OPERATION_LABELS[o]).join(", ")],
    ["Ubicación", zone || "Sin ubicación"],
    ["Dirección", [p.address, p.unit].filter(Boolean).join(" — ") || "—"],
    [
      "Ambientes",
      [
        p.bedrooms !== null ? `${p.bedrooms} dorm.` : null,
        p.bathrooms !== null ? `${p.bathrooms} ${p.bathrooms === 1 ? "baño" : "baños"}` : null,
        p.suites ? `${p.suites} suite(s)` : null,
        p.garages !== null ? `${p.garages} ${p.garages === 1 ? "garaje" : "garajes"}` : null,
      ]
        .filter(Boolean)
        .join(" · ") || "—",
    ],
    [
      "Superficie",
      [
        p.builtArea ? `${p.builtArea.replace(/\.00$/, "")} m² edificados` : null,
        p.totalArea ? `${p.totalArea.replace(/\.00$/, "")} m² totales` : null,
      ]
        .filter(Boolean)
        .join(" · ") || "—",
    ],
    [
      "Detalles",
      [
        p.floor ? `Piso ${p.floor}` : null,
        p.orientation ? `Orientación ${ORIENTATION_LABELS[p.orientation as Orientation]}` : null,
        p.condition ? PROPERTY_CONDITION_LABELS[p.condition as PropertyCondition] : null,
        p.yearBuilt ? `Año ${p.yearBuilt}` : null,
        p.petsAllowed ? "Acepta mascotas" : null,
        p.furnished ? "Amueblada" : null,
      ]
        .filter(Boolean)
        .join(" · ") || "—",
    ],
    [
      "Comodidades",
      p.features.length
        ? p.features.map((f) => PROPERTY_FEATURE_LABELS[f as PropertyFeature]).join(", ")
        : "—",
    ],
    ["Comisión", p.commissionBasisPoints !== null ? formatBasisPoints(p.commissionBasisPoints) : "—"],
    ["Responsable", data.assignedName ?? "—"],
    ["Captador", data.captadorName ?? "—"],
  ];

  const priceRows = p.operations.map((op) => {
    const pr = data.prices.find((x) => x.operation === op);
    return {
      operation: op,
      currency: pr?.currency ?? (op === "sale" ? ("USD" as const) : ("UYU" as const)),
      list: minorToInput(pr?.listMinor ?? null),
      ownerAsking: minorToInput(pr?.ownerAskingMinor ?? null),
      minimum: minorToInput(pr?.minimumMinor ?? null),
    };
  });

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4 pb-5">
        <div className="flex min-w-0 gap-4">
          <div className="relative hidden size-20 shrink-0 overflow-hidden rounded-lg border bg-surface-muted sm:block">
            {cover ? (
              <PrivateImage mediaId={cover.id} alt="" priority />
            ) : (
              <div className="flex size-full items-center justify-center text-muted-foreground">
                <ImageOff className="size-5" aria-hidden />
              </div>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">
              <Link href="/properties" className="hover:underline">
                Propiedades
              </Link>{" "}
              / <span className="font-mono">{p.code}</span>
            </p>
            <h1 className="mt-0.5 flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight">
              {data.displayTitle}
              <PropertyStatusBadge status={p.status} />
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {PROPERTY_TYPE_LABELS[p.type]} · {zone || "Sin ubicación"}
              {data.prices
                .filter((pr) => pr.listMinor !== null)
                .map(
                  (pr) => ` · ${PROPERTY_OPERATION_LABELS[pr.operation]} ${price(pr.listMinor, pr.currency)}`,
                )
                .join("")}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {can.update && (
            <Button asChild variant="secondary" size="sm">
              <Link href={`/properties/${p.id}/edit`}>
                <Pencil /> Editar
              </Link>
            </Button>
          )}
          {can.update && (
            <PropertyStatusControl
              propertyId={p.id}
              status={p.status as PropertyStatus}
              canWithdraw={can.withdraw}
              missing={data.checklist}
            />
          )}
        </div>
      </div>

      <nav aria-label="Secciones de la propiedad" className="mb-5 flex gap-1 overflow-x-auto border-b">
        {TABS.map((t) =>
          "phase" in t ? (
            <span
              key={t.key}
              className="flex shrink-0 cursor-not-allowed items-center gap-1 px-3 py-2 text-sm text-muted-foreground/60"
              title={`Disponible en la Fase ${t.phase}`}
            >
              {t.label} <span className="text-[10px]">F{t.phase}</span>
            </span>
          ) : (
            <Link
              key={t.key}
              href={`?tab=${t.key}`}
              aria-current={tab === t.key ? "page" : undefined}
              className={cn(
                "shrink-0 border-b-2 px-3 py-2 text-sm",
                tab === t.key
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              {t.key === "media" && (
                <span className="ml-1 text-xs text-muted-foreground">{data.media.length}</span>
              )}
            </Link>
          ),
        )}
      </nav>

      {tab === "media" ? (
        <MediaManager
          propertyId={p.id}
          canEdit={can.update}
          items={data.media.map((m) => ({
            id: m.id,
            kind: m.kind,
            url: m.url,
            caption: m.caption,
            isCover: m.isCover,
            width: m.width,
            height: m.height,
          }))}
        />
      ) : tab === "prices" && priceHistory ? (
        <div className="grid gap-5">
          <Card>
            <div className="flex items-center justify-between border-b px-4 py-2">
              <h2 className="text-sm font-semibold">Precios vigentes</h2>
              {can.priceUpdate && (
                <PricesEditor propertyId={p.id} initial={priceRows} canFloor={can.priceFloor} />
              )}
            </div>
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Operación</TH>
                  <TH className="text-right">Publicado</TH>
                  <TH className="text-right">Pedido propietario</TH>
                  <TH className="text-right">Mínimo autorizado</TH>
                </TR>
              </THead>
              <TBody>
                {p.operations.map((op) => {
                  const pr = data.prices.find((x) => x.operation === op);
                  return (
                    <TR key={op}>
                      <TD>{PROPERTY_OPERATION_LABELS[op]}</TD>
                      <TD className="text-right font-medium tabular">
                        {pr ? price(pr.listMinor, pr.currency) : "—"}
                      </TD>
                      <TD className="text-right tabular">
                        {pr ? price(pr.ownerAskingMinor, pr.currency) : "—"}
                      </TD>
                      <TD className="text-right tabular">
                        {pr?.minimumHidden ? (
                          <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <Lock className="size-3" aria-hidden /> Restringido
                          </span>
                        ) : pr ? (
                          price(pr.minimumMinor, pr.currency)
                        ) : (
                          "—"
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </Card>
          <Card>
            <h2 className="border-b px-4 py-3 text-sm font-semibold">Historial de precios</h2>
            {priceHistory.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">Todavía no hubo cambios de precio.</p>
            ) : (
              <Table>
                <THead>
                  <TR className="hover:bg-transparent">
                    <TH>Fecha</TH>
                    <TH>Operación</TH>
                    <TH>Campo</TH>
                    <TH className="text-right">Antes</TH>
                    <TH className="text-right">Después</TH>
                    <TH className="hidden md:table-cell">Usuario y motivo</TH>
                  </TR>
                </THead>
                <TBody>
                  {priceHistory.map((h) => {
                    const down = h.oldMinor !== null && h.newMinor !== null && h.newMinor < h.oldMinor;
                    return (
                      <TR key={h.id}>
                        <TD className="whitespace-nowrap text-muted-foreground">
                          {formatDateTime(h.changedAt)}
                        </TD>
                        <TD>{PROPERTY_OPERATION_LABELS[h.operation]}</TD>
                        <TD>{PRICE_FIELD_LABELS[h.field as PriceField]}</TD>
                        <TD className="text-right tabular text-muted-foreground">
                          {price(h.oldMinor, h.currency)}
                        </TD>
                        <TD className={cn("text-right font-medium tabular", down && "text-success")}>
                          {price(h.newMinor, h.currency)}
                        </TD>
                        <TD className="hidden text-muted-foreground md:table-cell">
                          {h.actorName ?? "—"}
                          {h.reason ? ` · ${h.reason}` : ""}
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            )}
          </Card>
        </div>
      ) : tab === "valuations" && valuations ? (
        <Card>
          <div className="flex items-center justify-between border-b px-4 py-2">
            <h2 className="text-sm font-semibold">Tasaciones</h2>
            {can.valuationManage && <NewValuationButton propertyId={p.id} />}
          </div>
          <ValuationList items={valuations} />
        </Card>
      ) : tab === "documents" && documents ? (
        <DocumentsPanel
          entityType="property"
          entityId={p.id}
          defaultCategory="property"
          hiddenCount={documents.hiddenCount}
          canUpload={documents.canUpload}
          canUploadConfidential={documents.canUploadConfidential}
          items={documents.items.map((d) => ({
            id: d.id,
            category: d.category,
            type: d.type,
            name: d.name,
            mimeType: d.mimeType,
            sizeBytes: d.sizeBytes,
            expiresAt: d.expiresAt,
            visibility: d.visibility,
            status: d.status,
            uploadedBy: d.uploadedBy,
            createdAt: d.createdAt.toISOString(),
            canManage: d.canManage,
          }))}
        />
      ) : tab === "history" && history ? (
        <Card>
          <h2 className="border-b px-4 py-3 text-sm font-semibold">Historial</h2>
          <ul className="divide-y">
            {history.map((h) => (
              <li
                key={h.id}
                className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5 text-sm"
              >
                <span>
                  {auditActionLabel(h.action)}
                  {h.status?.from && h.status.to && (
                    <span className="text-muted-foreground">
                      {" "}
                      · {PROPERTY_STATUS_LABELS[h.status.from as PropertyStatus]} →{" "}
                      {PROPERTY_STATUS_LABELS[h.status.to as PropertyStatus]}
                    </span>
                  )}
                  {h.status?.note && (
                    <span className="block text-xs text-muted-foreground">“{h.status.note}”</span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  {h.actorName ?? "Sistema"} · {formatDateTime(h.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <div className="grid content-start gap-5">
            <Card>
              <h2 className="border-b px-4 py-3 text-sm font-semibold">Ficha</h2>
              <dl className="divide-y text-sm">
                {facts.map(([k, v]) => (
                  <div key={k} className="grid grid-cols-[8.5rem_1fr] gap-3 px-4 py-2">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            </Card>
            <Card>
              <h2 className="border-b px-4 py-3 text-sm font-semibold">Descripción</h2>
              <p className="whitespace-pre-wrap px-4 py-3 text-sm">
                {p.description || <span className="text-muted-foreground">Sin descripción.</span>}
              </p>
              {p.internalNotes && (
                <div className="border-t px-4 py-3 text-sm">
                  <p className="text-xs text-muted-foreground">Notas internas (no se publican)</p>
                  <p className="whitespace-pre-wrap">{p.internalNotes}</p>
                </div>
              )}
            </Card>
            {data.expenses.length > 0 && (
              <Card>
                <h2 className="border-b px-4 py-3 text-sm font-semibold">Gastos</h2>
                <ul className="divide-y text-sm">
                  {data.expenses.map((e) => (
                    <li key={e.id} className="flex justify-between gap-3 px-4 py-2">
                      <span>
                        {EXPENSE_KIND_LABELS[e.kind]}
                        {e.label ? <span className="text-muted-foreground"> · {e.label}</span> : null}
                      </span>
                      <span className="tabular">
                        {price(e.amountMinor, e.currency)}{" "}
                        <span className="text-xs text-muted-foreground">
                          {EXPENSE_PERIOD_LABELS[e.period].toLowerCase()}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>

          <div className="grid content-start gap-5">
            {p.status === "draft" || data.checklist.length > 0 ? (
              <Card>
                <h2 className="border-b px-4 py-3 text-sm font-semibold">Para publicar</h2>
                {data.checklist.length === 0 ? (
                  <p className="flex items-center gap-2 px-4 py-3 text-sm text-success">
                    <CheckCircle2 className="size-4" aria-hidden /> La ficha está completa.
                  </p>
                ) : (
                  <ul className="grid gap-1.5 px-4 py-3 text-sm">
                    {data.checklist.map((m) => (
                      <li key={m} className="flex items-center gap-2">
                        <CircleAlert className="size-4 shrink-0 text-warning" aria-hidden /> {m}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            ) : null}

            <Card>
              <div className="flex items-center justify-between border-b px-4 py-2">
                <h2 className="text-sm font-semibold">Propietarios</h2>
                {can.update && data.ownerIdsForEdit && (
                  <OwnersEditor propertyId={p.id} initial={data.ownerIdsForEdit} />
                )}
                {can.update && !data.ownerIdsForEdit && (
                  <span
                    className="text-xs text-muted-foreground"
                    title="Hay propietarios cuya ficha no podés ver"
                  >
                    Los edita quien gestiona sus fichas
                  </span>
                )}
              </div>
              {data.owners.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted-foreground">Sin propietarios asociados.</p>
              ) : (
                <ul className="divide-y text-sm">
                  {data.owners.map((o, i) => (
                    <li key={o.contactId ?? i} className="flex justify-between gap-3 px-4 py-2">
                      {o.contactId ? (
                        <Link href={`/crm/contacts/${o.contactId}?tab=owner`} className="hover:underline">
                          {o.displayName}
                        </Link>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <Lock className="size-3" aria-hidden /> {o.displayName}
                        </span>
                      )}
                      <span className="tabular text-muted-foreground">
                        {formatBasisPoints(o.shareBasisPoints)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <div className="flex items-center justify-between border-b px-4 py-2">
                <h2 className="text-sm font-semibold">Precios</h2>
                <Link href="?tab=prices" className="text-xs text-primary hover:underline">
                  Ver historial
                </Link>
              </div>
              <ul className="divide-y text-sm">
                {p.operations.map((op) => {
                  const pr = data.prices.find((x) => x.operation === op);
                  return (
                    <li key={op} className="flex justify-between gap-3 px-4 py-2">
                      <span className="text-muted-foreground">{PROPERTY_OPERATION_LABELS[op]}</span>
                      <strong className="tabular">
                        {pr ? price(pr.listMinor, pr.currency) : "Sin precio"}
                      </strong>
                    </li>
                  );
                })}
              </ul>
            </Card>

            {data.acquisitions.length > 0 && (
              <Card>
                <h2 className="border-b px-4 py-3 text-sm font-semibold">Captación</h2>
                <ul className="divide-y text-sm">
                  {data.acquisitions.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                      <Link href={`/properties/acquisitions/${a.id}`} className="font-mono hover:underline">
                        {a.code}
                      </Link>
                      <span className="flex items-center gap-1.5">
                        {a.exclusive && (
                          <Badge tone="outline">Exclusiva hasta {formatDay(a.exclusiveUntil)}</Badge>
                        )}
                        <AcquisitionStageBadge stage={a.stage} />
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            <p className="text-xs text-muted-foreground">
              Creada {formatDateTime(p.createdAt)}
              {p.publishedAt ? ` · Publicada ${formatDateTime(p.publishedAt)}` : ""} · {data.valuationCount}{" "}
              tasación(es)
            </p>
          </div>
        </div>
      )}
    </>
  );
}
