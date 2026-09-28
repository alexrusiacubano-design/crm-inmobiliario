import {
  getContact,
  hasPermission,
  listAssignees,
  listTimeline,
  NotFoundError,
  ValidationError,
} from "@crm/core";
import { getDb } from "@crm/db";
import {
  CHANNEL_TYPE_LABELS,
  DOCUMENT_TYPE_LABELS,
  LEAD_OPERATION_LABELS,
  LEAD_SOURCE_LABELS,
  formatCI,
} from "@crm/shared";
import { AlertTriangle, FileSearch } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChannelIcon, LeadStatusBadge, channelHref } from "@/components/crm/badges";
import { DeleteContactButton, DuplicateRow } from "@/components/crm/contact-actions";
import { EditContactButton } from "@/components/crm/contact-dialog";
import type { ContactFormValues } from "@/components/crm/contact-fields";
import { NewLeadButton } from "@/components/crm/lead-dialog";
import { OwnerPanel } from "@/components/crm/owner-panel";
import { Timeline } from "@/components/crm/timeline";
import { Badge, Card, EmptyState } from "@/components/ui/misc";
import { requireSession } from "@/lib/session";
import { cn, formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Contacto" };

/** Pestañas de la ficha 360°. Las de fases futuras se muestran deshabilitadas con su fase. */
const TABS = [
  { key: "summary", label: "Resumen" },
  { key: "timeline", label: "Timeline" },
  { key: "owner", label: "Propietario" },
  { key: "matches", label: "Propiedades compatibles", phase: 4 },
  { key: "visits", label: "Visitas", phase: 5 },
  { key: "offers", label: "Ofertas", phase: 6 },
  { key: "documents", label: "Documentos", phase: 3 },
] as const;

export default async function ContactPage({
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

  const data = await getContact(db, ctx, id).catch((error: unknown) => {
    if (error instanceof NotFoundError || error instanceof ValidationError) notFound();
    throw error;
  });
  if ("redirectTo" in data) redirect(`/crm/contacts/${data.redirectTo}`);
  const { contact: c, channels, tags, leads, owner, duplicates, permissions } = data;
  const assignees = permissions.assign ? await listAssignees(db, ctx) : undefined;
  const timeline = tab === "timeline" ? await listTimeline(db, ctx, { contactId: c.id }) : null;

  const formValues: ContactFormValues = {
    kind: c.kind,
    firstName: c.firstName ?? "",
    lastName: c.lastName ?? "",
    companyName: c.companyName ?? "",
    documentType: c.documentHidden ? "" : (c.documentType ?? ""),
    documentNumber: c.documentNumber ?? "",
    nationality: c.nationality ?? "",
    address: c.address ?? "",
    notes: c.notes ?? "",
    assignedUserId: c.assignedUserId ?? "",
    tags: tags.join(", "),
    channels: channels.map((ch) => ({ type: ch.type, value: ch.value, isPrimary: ch.isPrimary })),
  };
  const doc = c.documentNumber
    ? `${DOCUMENT_TYPE_LABELS[c.documentType ?? "other"]} ${c.documentType === "ci" ? formatCI(c.documentNumber) : c.documentNumber}`
    : c.documentHidden
      ? "Documento registrado (restringido a tu rol)"
      : null;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4 pb-5">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            <Link href="/crm/contacts" className="hover:underline">
              Contactos
            </Link>{" "}
            /
          </p>
          <h1 className="mt-0.5 text-xl font-semibold tracking-tight">{c.displayName}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            {c.kind === "company" && <Badge tone="outline">Empresa</Badge>}
            {owner && <Badge tone="success">Propietario</Badge>}
            {leads.some((l) => !["won", "lost"].includes(l.status)) && (
              <Badge tone="primary">Cliente activo</Badge>
            )}
            {tags
              .filter((t) => !(owner && t === "Propietario"))
              .map((t) => (
                <Link key={t} href={`/crm/contacts?tag=${encodeURIComponent(t)}`}>
                  <Badge>{t}</Badge>
                </Link>
              ))}
            <span>
              · Responsable: {c.assignedName ?? "—"}
              {c.branchName ? ` · ${c.branchName}` : ""}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {permissions.delete && <DeleteContactButton contactId={c.id} name={c.displayName} />}
          {permissions.update && (
            <EditContactButton contactId={c.id} initial={formValues} assignees={assignees} />
          )}
          {permissions.createLead && (
            <NewLeadButton preset={{ id: c.id, displayName: c.displayName }} assignees={assignees} />
          )}
        </div>
      </div>

      {duplicates.length > 0 && (
        <div
          role="status"
          className="mb-5 rounded-md border border-warning/40 bg-warning-soft px-4 py-3 text-sm"
        >
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="size-4" aria-hidden /> Posibles duplicados
          </p>
          <ul className="mt-1 divide-y divide-warning/20">
            {duplicates.map((d) => (
              <DuplicateRow
                key={d.candidateId}
                candidateId={d.candidateId}
                currentId={c.id}
                currentName={c.displayName}
                other={{ id: d.contactId, name: d.displayName }}
                reasons={d.reasons}
                canMerge={permissions.merge}
              />
            ))}
          </ul>
        </div>
      )}

      <nav aria-label="Secciones del contacto" className="mb-5 flex gap-1 overflow-x-auto border-b">
        {TABS.map((t) => {
          const planned = "phase" in t;
          const active = tab === t.key;
          return planned ? (
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
              aria-current={active ? "page" : undefined}
              className={cn(
                "shrink-0 border-b-2 px-3 py-2 text-sm",
                active
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      {tab === "timeline" && timeline ? (
        <Timeline
          initial={timeline.items.map((i) => ({ ...i, occurredAt: i.occurredAt.toISOString() }))}
          nextCursor={timeline.nextCursor}
          contactId={c.id}
          canLog={permissions.update || permissions.ownerUpdate}
          showLeadLinks
        />
      ) : tab === "owner" ? (
        <div className="max-w-2xl">
          <OwnerPanel
            contactId={c.id}
            owner={owner}
            canUpdate={permissions.ownerUpdate}
            canFinancialRead={permissions.ownerFinancialRead}
            canFinancialUpdate={permissions.ownerFinancialUpdate}
          />
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
          <Card>
            <h2 className="border-b px-4 py-3 text-sm font-semibold">Datos</h2>
            <dl className="grid gap-3 p-4 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Teléfonos y emails</dt>
                <dd>
                  {channels.length === 0 ? (
                    <span className="text-muted-foreground">Sin datos de contacto</span>
                  ) : (
                    <ul className="mt-1 grid gap-1">
                      {channels.map((ch) => (
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
                          <span className="text-xs text-muted-foreground">
                            {CHANNEL_TYPE_LABELS[ch.type]}
                            {ch.isPrimary ? " · principal" : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Documento</dt>
                <dd className="tabular">{doc ?? "—"}</dd>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <dt className="text-xs text-muted-foreground">Nacionalidad</dt>
                  <dd>{c.nationality ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Alta</dt>
                  <dd>{formatDateTime(c.createdAt)}</dd>
                </div>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Dirección</dt>
                <dd>{c.address ?? "—"}</dd>
              </div>
              {c.notes && (
                <div>
                  <dt className="text-xs text-muted-foreground">Notas</dt>
                  <dd className="whitespace-pre-wrap">{c.notes}</dd>
                </div>
              )}
            </dl>
          </Card>

          <Card>
            <h2 className="border-b px-4 py-3 text-sm font-semibold">Búsquedas y leads</h2>
            {leads.length === 0 ? (
              <EmptyState
                icon={FileSearch}
                title="Sin leads"
                description={
                  data.hiddenLeadCount
                    ? `Tiene ${data.hiddenLeadCount} lead(s) de otros agentes.`
                    : "Cuando consulte por comprar o alquilar, creá un lead."
                }
              />
            ) : (
              <ul className="divide-y">
                {leads.map((l) => (
                  <li key={l.id}>
                    <Link
                      href={`/crm/leads/${l.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-surface-muted/50"
                    >
                      <span className="min-w-0">
                        <span className="font-mono text-xs text-muted-foreground">{l.code}</span>{" "}
                        <span className="font-medium">{LEAD_OPERATION_LABELS[l.operation]}</span>
                        <span className="block text-xs text-muted-foreground">
                          {LEAD_SOURCE_LABELS[l.source]} · {l.assignedName ?? "Sin responsable"} ·{" "}
                          {formatDateTime(l.createdAt)}
                        </span>
                      </span>
                      <LeadStatusBadge status={l.status} />
                    </Link>
                  </li>
                ))}
                {data.hiddenLeadCount > 0 && (
                  <li className="px-4 py-2 text-xs text-muted-foreground">
                    +{data.hiddenLeadCount} lead(s) de otros agentes
                  </li>
                )}
              </ul>
            )}
          </Card>
        </div>
      )}
      {!hasPermission(ctx, "contact.read") && (
        <p className="mt-4 text-xs text-muted-foreground">Estás viendo este contacto como propietario.</p>
      )}
    </>
  );
}
