import {
  activeContractFor,
  dealsForProperty,
  getProperty,
  hasPermission,
  listEntityDocuments,
  listOffers,
  listPriceHistory,
  listPropertyHistory,
  listPublications,
  listValuationsFor,
  NotFoundError,
  ValidationError,
} from "@crm/core";
import { getDb } from "@crm/db";
import {
  EXPENSE_KIND_LABELS,
  EXPENSE_PERIOD_LABELS,
  formatBasisPoints,
  PRICE_FIELD_LABELS,
  PROPERTY_FEATURE_LABELS,
  PROPERTY_OPERATION_LABELS,
  PROPERTY_STATUS_LABELS,
  PROPERTY_TYPE_LABELS,
  dealStageLabel,
  type PriceField,
  type PropertyFeature,
  type PropertyStatus,
} from "@crm/shared";
import { PORTAL_LABELS } from "@crm/shared/publications";
import {
  Bath,
  BedDouble,
  CheckCircle2,
  CircleAlert,
  Lock,
  MapPin,
  Pencil,
  Printer,
  Ruler,
  Star,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EventsPanel } from "@/components/agenda/events-panel";
import { NewDealButton } from "@/components/deals/new-deal-dialog";
import { PropertyMatchesPanel } from "@/components/matching/property-matches-panel";
import { OffersTable } from "@/components/deals/offers-table";
import { PublishButton } from "@/components/publications/publication-controls";
import { PublicationsTable } from "@/components/publications/publications-table";
import { DEFAULT_TZ, ymdInTz } from "@/lib/tz";
import { AcquisitionStageBadge, PropertyStatusBadge } from "@/components/properties/badges";
import { DocumentsPanel } from "@/components/properties/documents-panel";
import { formatDay, minorToInput, price } from "@/components/properties/format";
import { MediaManager } from "@/components/properties/media-manager";
import { OwnersEditor } from "@/components/properties/owners-editor";
import { PricesEditor } from "@/components/properties/prices-editor";
import { ExclusivityToggle } from "@/components/properties/exclusivity-toggle";
import { propertyFormValues } from "@/components/properties/form-values";
import { PropertyGallery } from "@/components/properties/property-gallery";
import { PropertyQuickEdit } from "@/components/properties/quick-edit";
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
  { key: "matches", label: "Clientes compatibles" },
  { key: "agenda", label: "Visitas" },
  { key: "offers", label: "Ofertas" },
  { key: "publications", label: "Publicaciones" },
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

  const today = ymdInTz(new Date(), ctx.organization.timezone || DEFAULT_TZ);
  const [priceHistory, history, documents, valuations, deals, offers, contract, pubs] = await Promise.all([
    tab === "prices" ? listPriceHistory(db, ctx, p.id) : Promise.resolve(null),
    tab === "history" ? listPropertyHistory(db, ctx, p.id) : Promise.resolve(null),
    tab === "documents" ? listEntityDocuments(db, ctx, "property", p.id) : Promise.resolve(null),
    tab === "valuations" ? listValuationsFor(db, ctx, { propertyId: p.id }) : Promise.resolve(null),
    dealsForProperty(db, ctx, p.id),
    tab === "offers" && hasPermission(ctx, "offer.read")
      ? listOffers(db, ctx, { status: "all", propertyId: p.id })
      : Promise.resolve(null),
    activeContractFor(db, ctx, p.id),
    hasPermission(ctx, "publication.read")
      ? listPublications(db, ctx, { status: "all", propertyId: p.id, today })
      : Promise.resolve(null),
  ]);
  const openDeals = deals.filter((d) => d.stage !== "closed" && d.stage !== "fallen");

  // "Pocitos, Montevideo" (sin repetir cuando la localidad se llama igual que el departamento).
  const zone = [...new Set([data.zone.neighborhood, data.zone.locality, data.zone.department])]
    .filter(Boolean)
    .join(", ");


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

  const photos = data.media
    .filter((m) => m.kind === "photo")
    .sort((a, b) => Number(b.isCover) - Number(a.isCover))
    .map((m) => ({ id: m.id, caption: m.caption }));
  const video = data.media.find((m) => m.kind === "video" && m.url);
  const youtubeId = video?.url?.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/)?.[1] ?? null;
  const lat = p.latitude ? Number(p.latitude) : null;
  const lng = p.longitude ? Number(p.longitude) : null;
  const hasMap = lat !== null && lng !== null;
  const publishedOn = (pubs?.items ?? []).filter((x) => x.status === "published");
  const formValues = propertyFormValues(data);
  const exclusive = p.exclusive || data.acquisitions.some((a) => a.exclusive);
  const exclusiveUntil = p.exclusive
    ? p.exclusiveUntil
    : (data.acquisitions.find((a) => a.exclusive)?.exclusiveUntil ?? null);

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4 pb-5">
        <div className="flex min-w-0 gap-4">
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
          {hasPermission(ctx, "deal.manage") &&
            ["available", "published", "negotiating", "reserved"].includes(p.status) && (
              <NewDealButton
                variant="secondary"
                label="Iniciar operación"
                preset={{
                  property: { id: p.id, label: `${p.code} · ${data.displayTitle}` },
                  operation: p.operations[0],
                }}
              />
            )}
          {can.update && (
            <Button asChild variant="secondary" size="sm">
              <Link href={`/properties/${p.id}/edit`}>
                <Pencil /> Editar
              </Link>
            </Button>
          )}
          <Button asChild variant="secondary" size="sm">
            <a href={`/print/propiedad/${p.id}`} target="_blank" rel="noreferrer">
              <Printer /> Ficha
            </a>
          </Button>
        </div>
      </div>

      {contract && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border bg-primary-soft/40 px-4 py-2 text-sm">
          <span className="font-medium">Alquilada:</span>
          <Link href={`/rentals/contracts/${contract.id}`} className="hover:underline">
            <span className="font-mono">{contract.code}</span> · {contract.tenantName} ·{" "}
            {price(contract.rentMinor, contract.currency)} por mes · vence el {formatDay(contract.endDate)}
          </Link>
        </div>
      )}
      {openDeals.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-warning/50 bg-warning-soft/40 px-4 py-2 text-sm">
          <span className="font-medium">Operaciones:</span>
          {openDeals.map((d) => (
            <Link key={d.id} href={`/commercial/deals/${d.id}`} className="hover:underline">
              <span className="font-mono">{d.code}</span> · {d.clientName} ·{" "}
              {dealStageLabel(d.stage, d.operation)}
            </Link>
          ))}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0">
          {tab !== "media" && (
            <div className="mb-5">
              <PropertyGallery
                photos={photos}
                title={data.displayTitle}
                manageHref={can.update ? "?tab=media" : undefined}
              />
            </div>
          )}
          <nav aria-label="Secciones de la propiedad" className="mb-5 flex gap-1 overflow-x-auto border-b">
            {TABS.map((t) => (
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
            ))}
          </nav>

          {tab === "publications" ? (
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
                <div>
                  <h2 className="text-sm font-semibold">Publicaciones en portales</h2>
                  <p className="text-xs text-muted-foreground">
                    Si la propiedad se reserva, los avisos se pausan; si se vende o alquila, se dan de baja
                    solos.
                  </p>
                </div>
                {pubs?.canManage && (
                  <PublishButton
                    propertyId={p.id}
                    portals={pubs.portals
                      .filter(
                        (x) =>
                          x.enabled &&
                          !pubs.items.some((i) => i.portal === x.portal && i.status !== "removed"),
                      )
                      .map((x) => x.portal)}
                    missing={data.checklist}
                  />
                )}
              </div>
              {pubs && pubs.items.length > 0 ? (
                <PublicationsTable rows={pubs.items} canManage={pubs.canManage} showProperty={false} />
              ) : (
                <p className="px-4 py-6 text-sm text-muted-foreground">
                  {pubs
                    ? pubs.canManage
                      ? "Todavía no está publicada en ningún portal."
                      : "Todavía no está publicada. La publicación la hace gerencia."
                    : "Tu rol no incluye ver publicaciones."}
                </p>
              )}
            </Card>
          ) : tab === "offers" ? (
            <Card>
              <div className="border-b px-4 py-3">
                <h2 className="text-sm font-semibold">Ofertas recibidas</h2>
                <p className="text-xs text-muted-foreground">
                  De todas las operaciones de esta propiedad. Se responden desde cada operación.
                </p>
              </div>
              {offers && offers.length > 0 ? (
                <OffersTable rows={offers} showProperty={false} today={today} />
              ) : (
                <p className="px-4 py-6 text-sm text-muted-foreground">
                  {offers ? "Sin ofertas registradas." : "Tu rol no incluye ver ofertas."}
                </p>
              )}
            </Card>
          ) : tab === "matches" ? (
            <PropertyMatchesPanel db={db} ctx={ctx} propertyId={p.id} />
          ) : tab === "agenda" ? (
            <EventsPanel
              db={db}
              ctx={ctx}
              target={{ propertyId: p.id }}
              defaults={{ type: "visit", property: { id: p.id, label: `${p.code} · ${data.displayTitle}` } }}
            />
          ) : tab === "media" ? (
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
                  <p className="px-4 py-6 text-sm text-muted-foreground">
                    Todavía no hubo cambios de precio.
                  </p>
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
            <div className="grid gap-5 lg:grid-cols-2">
              <div className="grid content-start gap-5">
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
                {p.features.length > 0 && (
              <Card>
                <h2 className="border-b px-4 py-3 text-sm font-semibold">Comodidades</h2>
                <ul className="flex flex-wrap gap-1.5 px-4 py-3">
                  {p.features.map((f) => (
                    <li key={f} className="rounded-full border px-2.5 py-0.5 text-xs">
                      {PROPERTY_FEATURE_LABELS[f as PropertyFeature] ?? f}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
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

                {data.acquisitions.length > 0 && (
                  <Card>
                    <h2 className="border-b px-4 py-3 text-sm font-semibold">Captación</h2>
                    <ul className="divide-y text-sm">
                      {data.acquisitions.map((a) => (
                        <li
                          key={a.id}
                          className="flex flex-wrap items-center justify-between gap-2 px-4 py-2"
                        >
                          <Link
                            href={`/properties/acquisitions/${a.id}`}
                            className="font-mono hover:underline"
                          >
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
                  {p.publishedAt ? ` · Publicada ${formatDateTime(p.publishedAt)}` : ""} ·{" "}
                  {data.valuationCount} tasación(es)
                </p>
              </div>
            </div>
          )}
        </div>
        <aside className="grid content-start gap-4 xl:sticky xl:top-20 xl:self-start">
          <Card className="grid gap-4 p-4">
            <div className="flex flex-wrap items-center gap-1.5">
              <PropertyStatusBadge status={p.status} />
              {exclusive && (
                <Badge tone="primary">
                  <Star className="mr-1 size-3 fill-current" aria-hidden /> Exclusiva
                </Badge>
              )}
              {contract && <Badge tone="outline">Alquilada</Badge>}
            </div>
            <div>
              <p className="text-xs text-muted-foreground">
                <span className="font-mono">{p.code}</span>
                {p.publishedAt ? ` · Publicada ${formatDay(p.publishedAt.toISOString().slice(0, 10))}` : ""}
              </p>
              <h2 className="mt-1 text-lg leading-snug font-semibold">{data.displayTitle}</h2>
              <div className="mt-2 grid gap-0.5">
                {p.operations.map((op) => {
                  const pr = data.prices.find((x) => x.operation === op);
                  return (
                    <p key={op} className="flex items-baseline justify-between gap-2">
                      <span className="text-xs text-muted-foreground">{PROPERTY_OPERATION_LABELS[op]}</span>
                      <span className="text-xl font-semibold text-primary tabular">
                        {pr?.listMinor != null ? price(pr.listMinor, pr.currency) : "Sin precio"}
                      </span>
                    </p>
                  );
                })}
                <Link href="?tab=prices" className="text-right text-xs text-primary hover:underline">
                  Precios e historial
                </Link>
              </div>
            </div>
            <div className="grid grid-cols-3 border-y py-3 text-center text-xs text-muted-foreground">
              <span className="grid justify-items-center gap-1">
                <BedDouble className="size-4" aria-hidden />
                {p.bedrooms ?? "—"} dorm.
              </span>
              <span className="grid justify-items-center gap-1">
                <Bath className="size-4" aria-hidden />
                {p.bathrooms ?? "—"} baños
              </span>
              <span className="grid justify-items-center gap-1">
                <Ruler className="size-4" aria-hidden />
                {p.builtArea ? `${Number(p.builtArea)} m²` : p.totalArea ? `${Number(p.totalArea)} m²` : "—"}
              </span>
            </div>
            <PropertyQuickEdit
              propertyId={p.id}
              initial={formValues}
              canEdit={can.update}
              extraRows={[
                [
                  "Comisión",
                  p.commissionBasisPoints !== null ? formatBasisPoints(p.commissionBasisPoints) : "—",
                ],
              ]}
            />
            <div className="grid gap-2 border-t pt-3 text-sm">
              <p className="flex items-start gap-1.5">
                <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span>
                  {[[p.address, p.unit].filter(Boolean).join(" — "), zone].filter(Boolean).join(", ") ||
                    "Sin ubicación"}
                </span>
              </p>
              {hasMap && (
                <>
                  <iframe
                    title="Mapa de la propiedad"
                    loading="lazy"
                    className="h-44 w-full rounded-lg border"
                    src={`https://www.openstreetmap.org/export/embed.html?bbox=${(lng as number) - 0.006},${(lat as number) - 0.004},${(lng as number) + 0.006},${(lat as number) + 0.004}&layer=mapnik&marker=${lat},${lng}`}
                  />
                  <div className="flex gap-2 text-xs">
                    <a
                      className="rounded-full border px-2.5 py-1 hover:bg-surface-muted"
                      href={`https://www.google.com/maps?q=${lat},${lng}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Google Maps
                    </a>
                    <a
                      className="rounded-full border px-2.5 py-1 hover:bg-surface-muted"
                      href={`https://waze.com/ul?ll=${lat},${lng}&navigate=yes`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Waze
                    </a>
                  </div>
                </>
              )}
            </div>
            {video && (
              <div className="grid gap-2 border-t pt-3">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Video</p>
                {youtubeId ? (
                  <iframe
                    title="Video de la propiedad"
                    loading="lazy"
                    className="aspect-video w-full rounded-lg border"
                    src={`https://www.youtube-nocookie.com/embed/${youtubeId}`}
                    allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                ) : (
                  <a
                    href={video.url ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-primary hover:underline"
                  >
                    Ver video
                  </a>
                )}
              </div>
            )}
            <ExclusivityToggle
              propertyId={p.id}
              exclusive={p.exclusive}
              until={p.exclusiveUntil}
              canEdit={can.update}
            />
            {!p.exclusive && exclusive && (
              <p className="-mt-2 text-xs text-muted-foreground">
                La captación figura como exclusiva hasta {formatDay(exclusiveUntil)}.
              </p>
            )}
            <dl className="grid gap-2 border-t pt-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Agente asignado</dt>
                <dd className="font-medium">{data.assignedName ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Captador</dt>
                <dd>{data.captadorName ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Propietario</dt>
                <dd className="grid gap-0.5">
                  {data.owners.length === 0 ? (
                    <span className="text-muted-foreground">Sin propietarios</span>
                  ) : (
                    data.owners.map((o, i) =>
                      o.contactId ? (
                        <Link
                          key={o.contactId}
                          href={`/crm/contacts/${o.contactId}?tab=owner`}
                          className="hover:underline"
                        >
                          {o.displayName}
                        </Link>
                      ) : (
                        <span key={i} className="text-muted-foreground">
                          {o.displayName}
                        </span>
                      ),
                    )
                  )}
                </dd>
              </div>
            </dl>
            {can.update && (
              <div className="grid gap-1.5 border-t pt-3">
                <p className="text-xs text-muted-foreground">Cambiar estado</p>
                <PropertyStatusControl
                  propertyId={p.id}
                  status={p.status as PropertyStatus}
                  canWithdraw={can.withdraw}
                  missing={data.checklist}
                />
              </div>
            )}
            {pubs && (
              <div className="grid gap-1.5 border-t pt-3">
                <p className="text-xs text-muted-foreground">Publicado en</p>
                {publishedOn.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Sin publicaciones activas ·{" "}
                    <Link href="?tab=publications" className="text-primary hover:underline">
                      Publicar
                    </Link>
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {publishedOn.map((x) =>
                      x.url ? (
                        <a
                          key={x.id}
                          href={x.url}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-full border border-success/40 bg-success-soft px-2.5 py-0.5 text-xs hover:underline"
                        >
                          {PORTAL_LABELS[x.portal]} ↗
                        </a>
                      ) : (
                        <span
                          key={x.id}
                          className="rounded-full border border-success/40 bg-success-soft px-2.5 py-0.5 text-xs"
                        >
                          {PORTAL_LABELS[x.portal]}
                        </span>
                      ),
                    )}
                  </div>
                )}
              </div>
            )}
          </Card>
        </aside>
      </div>
    </>
  );
}
