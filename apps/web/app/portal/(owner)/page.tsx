import { portalOverview } from "@crm/core";
import { getDb } from "@crm/db";
import {
  PROPERTY_OPERATION_LABELS,
  PROPERTY_STATUS_LABELS,
  PROPERTY_TYPE_LABELS,
  formatBasisPoints,
  type PropertyOperation,
  type PropertyStatus,
  type PropertyType,
} from "@crm/shared";
import { Building2, ImageOff } from "lucide-react";
import Link from "next/link";
import { formatDay, price } from "@/components/properties/format";
import { Badge, Card, EmptyState } from "@/components/ui/misc";
import { requirePortalSession } from "@/lib/session";
import { MessageForm } from "../portal-client";

export default async function PortalHome() {
  const { pctx } = await requirePortalSession();
  const ov = await portalOverview(getDb(), pctx);
  return (
    <>
      <h1 className="text-xl font-semibold">Hola, {pctx.ownerName}</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">
        Así van tus propiedades{ov.agent ? ` con ${ov.agent.name}` : ""}. Los datos se actualizan en el
        momento.
      </p>
      {ov.properties.length === 0 ? (
        <Card>
          <EmptyState
            icon={Building2}
            title="Sin propiedades"
            description="Todavía no hay propiedades a tu nombre."
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {ov.properties.map((p) => (
            <Link key={p.id} href={`/portal/propiedades/${p.id}`} className="group">
              <Card className="overflow-hidden transition group-hover:border-primary">
                <div className="aspect-[16/9] bg-surface-muted">
                  {p.coverId ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/portal/media/${p.coverId}`}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-muted-foreground">
                      <ImageOff className="size-6" />
                    </div>
                  )}
                </div>
                <div className="grid gap-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {p.title ?? PROPERTY_TYPE_LABELS[p.type as PropertyType]}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        <span className="font-mono">{p.code}</span>
                        {p.zone ? ` · ${p.zone}` : ""}
                        {p.shareBasisPoints < 10_000
                          ? ` · tu parte ${formatBasisPoints(p.shareBasisPoints)}`
                          : ""}
                      </p>
                    </div>
                    <Badge tone="outline">{PROPERTY_STATUS_LABELS[p.status as PropertyStatus]}</Badge>
                  </div>
                  {p.prices.map((x) => (
                    <p key={x.operation} className="text-sm">
                      {PROPERTY_OPERATION_LABELS[x.operation as PropertyOperation]}:{" "}
                      <span className="font-semibold">{price(x.listMinor, x.currency)}</span>
                    </p>
                  ))}
                  <dl className="grid grid-cols-4 gap-2 border-t pt-2 text-center text-xs">
                    <div>
                      <dt className="text-muted-foreground">Avisos</dt>
                      <dd className="font-semibold tabular">{p.publications.n}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Visitas 90 d</dt>
                      <dd className="font-semibold tabular">{p.visits.done}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Próximas</dt>
                      <dd className="font-semibold tabular">{p.visits.upcoming}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Ofertas</dt>
                      <dd className="font-semibold tabular">{p.offers}</dd>
                    </div>
                  </dl>
                  {p.contractEnd && (
                    <p className="text-xs text-muted-foreground">
                      Alquilada · contrato hasta el {formatDay(p.contractEnd)}
                    </p>
                  )}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
      <Card className="mt-6 p-4">
        <h2 className="mb-2 text-sm font-semibold">Escribile a tu agente</h2>
        <MessageForm />
      </Card>
    </>
  );
}
