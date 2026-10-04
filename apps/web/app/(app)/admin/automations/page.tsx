import { automationOptions, listRules, listRuns } from "@crm/core";
import { getDb } from "@crm/db";
import { AUTOMATION_TRIGGERS, RUN_STATUS_LABELS, type AutomationTrigger } from "@crm/shared/automations";
import type { Metadata } from "next";
import Link from "next/link";
import { RulesBoard, type RuleRow } from "@/components/automations/rules-board";
import { Badge, Card, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requirePagePermission } from "@/lib/session";
import { relativeLabel } from "@/lib/utils";

export const metadata: Metadata = { title: "Automatizaciones" };

const RUN_TONE = { success: "success", partial: "warning", error: "danger" } as const;

export default async function AutomationsPage() {
  const { ctx } = await requirePagePermission("automation.manage");
  const db = getDb();
  const [rules, runs, options] = await Promise.all([
    listRules(db, ctx),
    listRuns(db, ctx, { limit: 50 }),
    automationOptions(db, ctx),
  ]);
  const now = new Date();
  const rows: RuleRow[] = rules.map((r) => ({
    id: r.id,
    name: r.name,
    enabled: r.enabled,
    trigger: r.trigger as AutomationTrigger,
    days: r.days,
    conditions: r.conditions,
    actions: r.actions as Record<string, unknown>[],
    runCount: r.runCount,
    lastRunLabel: r.lastRunAt ? relativeLabel(r.lastRunAt, now) : null,
    actsAs: r.actsAs,
  }));
  const hasWebhook = rules.some((r) => r.actions.some((a) => a.type === "webhook"));

  return (
    <>
      <PageHeader
        title="Automatizaciones"
        description="Reglas disparador → condiciones → acciones: avisos, tareas, reparto de leads, etiquetas y webhooks. Lo que hace una automatización no dispara otras."
      />
      <RulesBoard rules={rows} options={options} />

      {hasWebhook && (
        <Card className="mb-8 p-4 text-sm">
          <p className="font-medium">Firma de los webhooks</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Cada envío trae el encabezado <code>X-CRM-Signature: sha256=…</code> (HMAC-SHA256 del cuerpo con
            la clave de la regla). Claves:
          </p>
          <ul className="mt-2 grid gap-1 text-xs">
            {rules
              .filter((r) => r.actions.some((a) => a.type === "webhook"))
              .map((r) => (
                <li key={r.id}>
                  {r.name}: <code className="break-all">{r.secret}</code>
                </li>
              ))}
          </ul>
        </Card>
      )}

      <h2 className="mb-3 text-lg font-semibold">Historial</h2>
      <Card>
        {runs.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            Todavía no se ejecutó ninguna automatización.
          </p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Cuándo</TH>
                <TH>Regla</TH>
                <TH>Sobre</TH>
                <TH>Resultado</TH>
              </TR>
            </THead>
            <TBody>
              {runs.map((r) => (
                <TR key={r.id}>
                  <TD className="whitespace-nowrap text-xs text-muted-foreground">
                    {relativeLabel(r.createdAt, now)}
                  </TD>
                  <TD>
                    <p className="text-sm">{r.ruleName}</p>
                    <p className="text-xs text-muted-foreground">
                      {AUTOMATION_TRIGGERS[r.trigger as AutomationTrigger]?.label ?? r.trigger}
                    </p>
                  </TD>
                  <TD className="text-sm">
                    {r.entityType === "lead" ? (
                      <Link href={`/crm/leads/${r.entityId}`} className="hover:underline">
                        {r.entityLabel}
                      </Link>
                    ) : (
                      r.entityLabel
                    )}
                  </TD>
                  <TD>
                    <Badge tone={RUN_TONE[r.status]}>{RUN_STATUS_LABELS[r.status]}</Badge>
                    <ul className="mt-1 text-xs text-muted-foreground">
                      {r.results.map((x, i) => (
                        <li key={i} className={x.ok ? undefined : "text-danger"}>
                          {x.detail}
                        </li>
                      ))}
                    </ul>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
