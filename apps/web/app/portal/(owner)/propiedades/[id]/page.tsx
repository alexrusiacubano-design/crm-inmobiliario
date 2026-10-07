import { NotFoundError, ValidationError, portalProperty } from "@crm/core";
import { getDb } from "@crm/db";
import {
  EVENT_STATUS_LABELS,
  VISIT_OUTCOME_LABELS,
  type EventStatus,
  type VisitOutcome,
} from "@crm/shared/agenda";
import {
  CHARGE_STATUS_LABELS,
  SETTLEMENT_STATUS_LABELS,
  type ChargeStatus,
  type SettlementStatus,
} from "@crm/shared/billing";
import {
  OFFER_PARTY_LABELS,
  OFFER_STATUS_LABELS,
  type OfferParty,
  type OfferStatus,
} from "@crm/shared/offers";
import {
  PROPERTY_OPERATION_LABELS,
  PROPERTY_STATUS_LABELS,
  type PropertyOperation,
  type PropertyStatus,
} from "@crm/shared/property";
import {
  PORTAL_LABELS,
  PUBLICATION_STATUS_LABELS,
  type Portal,
  type PublicationStatus,
} from "@crm/shared/publications";
import { ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDay, price } from "@/components/properties/format";
import { Badge, Card } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requirePortalSession } from "@/lib/session";
import { DEFAULT_TZ, ymdInTz } from "@/lib/tz";
import { formatDateTime } from "@/lib/utils";
import { MessageForm } from "../../../portal-client";

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <h2 className="border-b px-4 py-3 text-sm font-semibold">{title}</h2>
      <div className="overflow-x-auto">{children}</div>
    </Card>
  );
}
const Empty = ({ text }: { text: string }) => (
  <p className="px-4 py-5 text-sm text-muted-foreground">{text}</p>
);

export default async function PortalPropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const { pctx } = await requirePortalSession();
  const { id } = await params;
  const today = ymdInTz(new Date(), pctx.timezone || DEFAULT_TZ);
  const d = await portalProperty(getDb(), pctx, id, today).catch((e: unknown) => {
    if (e instanceof NotFoundError || e instanceof ValidationError) notFound();
    throw e;
  });
  const p = d.property;
  return (
    <div className="grid gap-5">
      <div>
        <Link
          href="/portal"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Mis propiedades
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">{p.title ?? p.code}</h1>
          <Badge tone="outline">{PROPERTY_STATUS_LABELS[p.status as PropertyStatus]}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          <span className="font-mono">{p.code}</span>
          {p.zone ? ` · ${p.zone}` : ""}
          {p.agentName ? ` · agente: ${p.agentName}` : ""}
        </p>
        <p className="mt-1 text-sm">
          {p.prices
            .map(
              (x) =>
                `${PROPERTY_OPERATION_LABELS[x.operation as PropertyOperation]}: ${price(x.listMinor, x.currency)}`,
            )
            .join(" · ")}
        </p>
      </div>

      {d.photos.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {d.photos.map((m) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={m}
              src={`/api/portal/media/${m}`}
              alt=""
              className="h-28 w-40 shrink-0 rounded-md object-cover"
              loading="lazy"
            />
          ))}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Block title="Publicaciones">
          {d.publications.length ? (
            <Table>
              <THead>
                <TR>
                  <TH>Portal</TH>
                  <TH>Estado</TH>
                  <TH className="text-right">Vistas</TH>
                  <TH className="text-right">Contactos</TH>
                </TR>
              </THead>
              <TBody>
                {d.publications.map((x, i) => (
                  <TR key={i}>
                    <TD>
                      {x.url ? (
                        <a
                          href={x.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          {PORTAL_LABELS[x.portal as Portal]} <ExternalLink className="size-3" />
                        </a>
                      ) : (
                        PORTAL_LABELS[x.portal as Portal]
                      )}
                    </TD>
                    <TD>{PUBLICATION_STATUS_LABELS[x.status as PublicationStatus]}</TD>
                    <TD className="text-right tabular">{x.views ?? "—"}</TD>
                    <TD className="text-right tabular">{x.contacts ?? "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <Empty text="Todavía no está publicada en portales." />
          )}
        </Block>
        <Block title="Visitas (último año)">
          {d.visits.length ? (
            <Table>
              <THead>
                <TR>
                  <TH>Fecha</TH>
                  <TH>Estado</TH>
                  <TH>Devolución</TH>
                </TR>
              </THead>
              <TBody>
                {d.visits.map((v, i) => (
                  <TR key={i}>
                    <TD className="whitespace-nowrap">{formatDateTime(v.startsAt)}</TD>
                    <TD>{EVENT_STATUS_LABELS[v.status as EventStatus]}</TD>
                    <TD className="text-xs">
                      {[
                        v.outcome ? VISIT_OUTCOME_LABELS[v.outcome as VisitOutcome] : null,
                        v.rating ? `${"★".repeat(v.rating)}` : null,
                        v.feedback,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <Empty text="Sin visitas registradas." />
          )}
        </Block>
      </div>

      <Block title="Ofertas">
        {d.offers.length ? (
          <Table>
            <THead>
              <TR>
                <TH>Fecha</TH>
                <TH>De</TH>
                <TH>Operación</TH>
                <TH className="text-right">Monto</TH>
                <TH>Estado</TH>
              </TR>
            </THead>
            <TBody>
              {d.offers.map((o, i) => (
                <TR key={i}>
                  <TD className="whitespace-nowrap">{formatDateTime(o.createdAt)}</TD>
                  <TD>{OFFER_PARTY_LABELS[o.party as OfferParty]}</TD>
                  <TD>{PROPERTY_OPERATION_LABELS[o.operation as PropertyOperation]}</TD>
                  <TD className="text-right tabular">{price(o.amountMinor, o.currency)}</TD>
                  <TD>{OFFER_STATUS_LABELS[o.status as OfferStatus]}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <Empty text="Sin ofertas por ahora." />
        )}
      </Block>

      {d.contract && (
        <>
          <Card className="p-4 text-sm">
            <h2 className="mb-1 font-semibold">Contrato de alquiler</h2>
            <p>
              <span className="font-mono text-xs">{d.contract.code}</span> · {d.contract.tenantName} · del{" "}
              {formatDay(d.contract.startDate)} al {formatDay(d.contract.endDate)} ·{" "}
              {price(d.contract.rentMinor, d.contract.currency)} por mes
            </p>
          </Card>
          <div className="grid gap-5">
            <Block title="Cuotas del inquilino">
              {d.charges.length ? (
                <Table>
                  <THead>
                    <TR>
                      <TH>Mes</TH>
                      <TH className="text-right">Total</TH>
                      <TH className="text-right">Cobrado</TH>
                      <TH>Estado</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {d.charges.map((c) => (
                      <TR key={c.period}>
                        <TD>{c.period.slice(0, 7).split("-").reverse().join("/")}</TD>
                        <TD className="text-right tabular">{price(c.totalMinor, c.currency)}</TD>
                        <TD className="text-right tabular">{price(c.paidMinor, c.currency)}</TD>
                        <TD>{CHARGE_STATUS_LABELS[c.status as ChargeStatus]}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              ) : (
                <Empty text="Sin cuotas generadas." />
              )}
            </Block>
            <Block title="Mis liquidaciones">
              {d.settlements.length ? (
                <Table>
                  <THead>
                    <TR>
                      <TH>Mes</TH>
                      <TH className="text-right">Cobrado</TH>
                      <TH className="text-right">Comisión y gastos</TH>
                      <TH className="text-right">Para vos</TH>
                      <TH>Estado</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {d.settlements.map((s) => (
                      <TR key={s.code}>
                        <TD>
                          {s.period.slice(0, 7).split("-").reverse().join("/")}
                          <a
                            href={`/portal/imprimir/${s.code}`}
                            target="_blank"
                            rel="noreferrer"
                            className="block font-mono text-[11px] text-primary hover:underline"
                          >
                            {s.code} · ver PDF
                          </a>
                        </TD>
                        <TD className="text-right tabular">{price(s.incomeMinor, s.currency)}</TD>
                        <TD className="text-right tabular">
                          {price((BigInt(s.feeMinor) + BigInt(s.deductionsMinor)).toString(), s.currency)}
                        </TD>
                        <TD className="text-right font-semibold tabular">
                          {price(s.myAmountMinor, s.currency)}
                        </TD>
                        <TD>
                          {SETTLEMENT_STATUS_LABELS[s.status as SettlementStatus]}
                          {s.paidAt && (
                            <span className="block text-[11px] text-muted-foreground">
                              {formatDay(s.paidAt)}
                            </span>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              ) : (
                <Empty text="Sin liquidaciones todavía." />
              )}
            </Block>
          </div>
        </>
      )}

      <Card className="p-4">
        <h2 className="mb-2 text-sm font-semibold">Consultar a tu agente por esta propiedad</h2>
        <MessageForm propertyId={p.id} />
      </Card>
    </div>
  );
}
