import {
  getAcquisition,
  hasPermission,
  listAssignees,
  listGeo,
  NotFoundError,
  ValidationError,
} from "@crm/core";
import { getDb } from "@crm/db";
import { formatBasisPoints, PROPERTY_OPERATION_LABELS, PROPERTY_TYPE_LABELS } from "@crm/shared";
import { CheckCircle2, CircleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AcquisitionStageControl, AcquisitionStepper } from "@/components/properties/acquisition-controls";
import {
  AcquisitionDialogButton,
  type AcquisitionFormValues,
} from "@/components/properties/acquisition-dialog";
import { AcquisitionStageBadge, PropertyStatusBadge } from "@/components/properties/badges";
import { daysUntil, formatDay, minorToInput, price } from "@/components/properties/format";
import { NewValuationButton } from "@/components/properties/valuation-dialog";
import { ValuationList } from "@/components/properties/valuation-list";
import { Card } from "@/components/ui/misc";
import { requireSession } from "@/lib/session";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Captación" };

export default async function AcquisitionPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requireSession();
  const { id } = await params;
  const db = getDb();
  const data = await getAcquisition(db, ctx, id).catch((error: unknown) => {
    if (error instanceof NotFoundError || error instanceof ValidationError) notFound();
    throw error;
  });
  const { acquisition: a, permissions: can } = data;
  const [geo, assignees] = await Promise.all([
    can.manage ? listGeo(db) : Promise.resolve(null),
    can.manage && can.reassign && hasPermission(ctx, "lead.assign")
      ? listAssignees(db, ctx)
      : Promise.resolve(undefined),
  ]);
  const locality = geo?.localities.find((l) => l.id === a.localityId);
  const initial: AcquisitionFormValues | null = data.owner.id
    ? {
        owner: { id: data.owner.id, displayName: data.owner.displayName },
        propertyType: a.propertyType,
        operation: a.operation,
        departmentId: locality ? String(locality.departmentId) : "",
        localityId: a.localityId ? String(a.localityId) : "",
        neighborhoodId: a.neighborhoodId ? String(a.neighborhoodId) : "",
        address: a.address ?? "",
        exclusive: a.exclusive,
        exclusiveFrom: a.exclusiveFrom ?? "",
        exclusiveUntil: a.exclusiveUntil ?? "",
        commissionPercent:
          a.commissionBasisPoints === null ? "" : minorToInput(BigInt(a.commissionBasisPoints)),
        currency: a.currency,
        askingPrice: minorToInput(a.askingMinor),
        recommendedPrice: minorToInput(a.recommendedMinor),
        publicationAuthorized: a.publicationAuthorized,
        captadorUserId: "",
        notes: a.notes ?? "",
      }
    : null;
  const days = a.exclusive && a.exclusiveUntil ? daysUntil(a.exclusiveUntil) : null;

  const rows: [string, React.ReactNode][] = [
    [
      "Propietario",
      data.owner.id ? (
        <Link href={`/crm/contacts/${data.owner.id}?tab=owner`} className="hover:underline">
          {data.owner.displayName}
        </Link>
      ) : (
        data.owner.displayName
      ),
    ],
    ["Inmueble", `${PROPERTY_TYPE_LABELS[a.propertyType]} · ${PROPERTY_OPERATION_LABELS[a.operation]}`],
    ["Ubicación", [a.address, data.zone].filter(Boolean).join(" — ") || "—"],
    ["Pide el propietario", price(a.askingMinor, a.currency)],
    ["Precio recomendado", price(a.recommendedMinor, a.currency)],
    ["Comisión", a.commissionBasisPoints !== null ? formatBasisPoints(a.commissionBasisPoints) : "—"],
    [
      "Exclusividad",
      a.exclusive ? (
        <span className={days !== null && days <= 30 ? "text-warning" : undefined}>
          {formatDay(a.exclusiveFrom)} → {formatDay(a.exclusiveUntil)}
          {days !== null ? (days < 0 ? " (vencida)" : ` (${days} días)`) : ""}
        </span>
      ) : (
        "No"
      ),
    ],
    [
      "Autorización",
      a.publicationAuthorized ? (
        <span className="inline-flex items-center gap-1 text-success">
          <CheckCircle2 className="size-4" aria-hidden /> Firmada
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-warning">
          <CircleAlert className="size-4" aria-hidden /> Pendiente
        </span>
      ),
    ],
    ["Captador", data.captadorName ?? "—"],
  ];

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4 pb-5">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            <Link href="/properties/acquisitions" className="hover:underline">
              Captaciones
            </Link>{" "}
            / <span className="font-mono">{a.code}</span>
          </p>
          <h1 className="mt-0.5 flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight">
            {data.owner.displayName}
            <AcquisitionStageBadge stage={a.stage} />
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Creada {formatDateTime(a.createdAt)} · en esta etapa desde {formatDateTime(a.stageChangedAt)}
            {a.stage === "lost" && a.lostReason ? ` · Motivo: ${a.lostReason}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {can.manage && geo && initial && (
            <AcquisitionDialogButton acquisitionId={a.id} initial={initial} geo={geo} assignees={assignees} />
          )}
          {can.manage && (
            <AcquisitionStageControl
              acquisitionId={a.id}
              stage={a.stage}
              authorized={a.publicationAuthorized}
              hasProperty={!!a.propertyId}
            />
          )}
        </div>
      </div>
      <div className="mb-5">
        <AcquisitionStepper stage={a.stage} />
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
        <div className="grid content-start gap-5">
          <Card>
            <h2 className="border-b px-4 py-3 text-sm font-semibold">Datos</h2>
            <dl className="divide-y text-sm">
              {rows.map(([k, v]) => (
                <div key={k} className="grid grid-cols-[9.5rem_1fr] gap-3 px-4 py-2">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            {a.notes && <p className="whitespace-pre-wrap border-t px-4 py-3 text-sm">{a.notes}</p>}
          </Card>
          <Card>
            <h2 className="border-b px-4 py-3 text-sm font-semibold">Propiedad</h2>
            {data.property ? (
              <div className="flex items-center justify-between gap-2 px-4 py-3 text-sm">
                <Link href={`/properties/${data.property.id}`} className="hover:underline">
                  <span className="font-mono">{data.property.code}</span> · {data.property.title}
                </Link>
                <PropertyStatusBadge status={data.property.status} />
              </div>
            ) : (
              <p className="px-4 py-3 text-sm text-muted-foreground">
                Se crea automáticamente al marcar la captación como “Captado” (requiere autorización firmada).
              </p>
            )}
          </Card>
        </div>
        <Card>
          <div className="flex items-center justify-between border-b px-4 py-2">
            <h2 className="text-sm font-semibold">Tasaciones</h2>
            {can.valuationManage && (
              <NewValuationButton
                acquisitionId={a.id}
                propertyId={a.propertyId}
                defaultCurrency={a.currency}
                subject={{ localityId: a.localityId, neighborhoodId: a.neighborhoodId }}
              />
            )}
          </div>
          <ValuationList items={data.valuations} />
        </Card>
      </div>
    </>
  );
}
