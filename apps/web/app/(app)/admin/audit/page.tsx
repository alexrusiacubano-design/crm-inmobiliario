import { listAuditLogs } from "@crm/core";
import { getDb } from "@crm/db";
import { ScrollText } from "lucide-react";
import type { Metadata } from "next";
import { Pagination } from "@/components/data/list-controls";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { AUDIT_ACTION_LABELS, AUDIT_ENTITY_LABELS, auditActionLabel } from "@/lib/audit-labels";
import { requirePagePermission } from "@/lib/session";
import { formatDateTime } from "@/lib/utils";
import { AuditFilters } from "./filters";

export const metadata: Metadata = { title: "Auditoría" };

type JsonObject = Record<string, unknown>;

/** Muestra solo los campos que cambiaron entre `before` y `after`. */
function changedFields(before: unknown, after: unknown): { key: string; from: unknown; to: unknown }[] {
  const b = (before && typeof before === "object" && !Array.isArray(before) ? before : {}) as JsonObject;
  const a = (after && typeof after === "object" && !Array.isArray(after) ? after : {}) as JsonObject;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter(
    (k) => !["updatedAt", "createdAt"].includes(k),
  );
  return keys
    .filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]))
    .map((key) => ({ key, from: b[key], to: a[key] }));
}

const show = (v: unknown) => (v === undefined ? "—" : typeof v === "string" ? v : JSON.stringify(v));

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { ctx } = await requirePagePermission("audit.read");
  const params = await searchParams;
  const list = await listAuditLogs(getDb(), ctx, params);

  return (
    <>
      <PageHeader
        title="Auditoría"
        description="Registro inalterable de las acciones críticas: quién, qué, cuándo, y los valores antes y después. Se escribe en el servidor dentro de la misma transacción que el cambio."
      />
      <Card>
        <div className="border-b p-3">
          <AuditFilters
            actions={Object.entries(AUDIT_ACTION_LABELS)}
            entities={Object.entries(AUDIT_ENTITY_LABELS)}
          />
        </div>
        {list.items.length === 0 ? (
          <EmptyState icon={ScrollText} title="Sin registros para estos filtros" />
        ) : (
          <ul className="divide-y">
            {list.items.map((item) => {
              const changes = changedFields(item.before, item.after);
              const isArrayDiff = Array.isArray(item.before) || Array.isArray(item.after);
              return (
                <li key={item.id}>
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center gap-4 px-4 py-3 text-sm hover:bg-surface-muted/50">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{auditActionLabel(item.action)}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {item.actorName ?? "Sistema"} ·{" "}
                          {AUDIT_ENTITY_LABELS[item.entityType] ?? item.entityType}{" "}
                          <span className="font-mono">{item.entityId.slice(0, 8)}</span>
                        </p>
                      </div>
                      <Badge tone="outline" className="hidden font-mono sm:inline-flex">
                        {item.action}
                      </Badge>
                      <time className="shrink-0 text-xs text-muted-foreground tabular">
                        {formatDateTime(item.createdAt)}
                      </time>
                    </summary>
                    <div className="grid gap-3 bg-surface-muted/40 px-4 py-3 text-xs">
                      {isArrayDiff ? (
                        <div className="grid gap-2 sm:grid-cols-2">
                          <pre className="overflow-x-auto rounded border bg-surface p-2">
                            {JSON.stringify(item.before, null, 2)}
                          </pre>
                          <pre className="overflow-x-auto rounded border bg-surface p-2">
                            {JSON.stringify(item.after, null, 2)}
                          </pre>
                        </div>
                      ) : changes.length === 0 ? (
                        <p className="text-muted-foreground">Sin cambios de valores registrados.</p>
                      ) : (
                        <table className="w-full">
                          <thead className="text-left text-muted-foreground">
                            <tr>
                              <th className="py-1 pr-4 font-medium">Campo</th>
                              <th className="py-1 pr-4 font-medium">Antes</th>
                              <th className="py-1 font-medium">Después</th>
                            </tr>
                          </thead>
                          <tbody className="font-mono">
                            {changes.map((c) => (
                              <tr key={c.key} className="align-top">
                                <td className="py-1 pr-4 font-sans font-medium">{c.key}</td>
                                <td className="max-w-xs break-all py-1 pr-4 text-danger">{show(c.from)}</td>
                                <td className="max-w-xs break-all py-1 text-success">{show(c.to)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      <p className="text-muted-foreground">
                        IP {item.metadata?.ip ?? "—"} · Request {item.metadata?.requestId?.slice(0, 8) ?? "—"}
                      </p>
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
        <Pagination page={list.page} pageSize={list.pageSize} total={list.total} />
      </Card>
    </>
  );
}
