"use client";

import { Pencil, Play, Plus, Sparkles, Trash2, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  ACTION_TYPE_LABELS,
  AUTOMATION_TRIGGERS,
  RULE_TEMPLATES,
  type ActionType,
  type AutomationTrigger,
  type Condition,
} from "@crm/shared/automations";
import {
  deleteRuleAction,
  runScheduleNowAction,
  setRuleEnabledAction,
} from "@/app/(app)/admin/automations/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/form";
import { Badge, Card, EmptyState } from "@/components/ui/misc";
import { RuleEditor, type EditorOptions, type RuleDraft } from "./rule-editor";

export interface RuleRow {
  id: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  days: number | null;
  conditions: Condition[];
  actions: Record<string, unknown>[];
  runCount: number;
  lastRunLabel: string | null;
  actsAs: string;
}

const EMPTY: RuleDraft = {
  name: "",
  enabled: true,
  trigger: "lead.created",
  days: null,
  conditions: [],
  actions: [{ type: "notify", to: "assignee", title: "", body: "" }],
};

export function RulesBoard({ rules, options }: { rules: RuleRow[]; options: EditorOptions }) {
  const router = useRouter();
  const [editing, setEditing] = useState<RuleDraft | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [pending, start] = useTransition();
  const open = (d: RuleDraft) => {
    setEditing(d);
    setEditorKey((k) => k + 1);
  };
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error);
      toast.success(ok);
      router.refresh();
    });

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        <Button onClick={() => open(EMPTY)}>
          <Plus /> Nueva automatización
        </Button>
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await runScheduleNowAction();
              if (!r.ok) return void toast.error(r.error);
              toast.success(
                r.data.runs
                  ? `${r.data.runs} ejecución(es) de ${r.data.rules} regla(s) programada(s)`
                  : "Nada nuevo para ejecutar",
              );
              router.refresh();
            })
          }
        >
          <Play /> Revisar programadas ahora
        </Button>
      </div>

      {rules.length === 0 ? (
        <Card className="mb-6">
          <EmptyState
            icon={Zap}
            title="Todavía no hay automatizaciones"
            description="Empezá con una de las sugeridas de abajo o creá la tuya."
          />
        </Card>
      ) : (
        <Card className="mb-6 divide-y">
          {rules.map((r) => {
            const t = AUTOMATION_TRIGGERS[r.trigger];
            return (
              <div key={r.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.name}</span>
                    {!r.enabled && <Badge tone="neutral">Pausada</Badge>}
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    <span className="text-foreground">Cuando:</span> {t?.label ?? r.trigger}
                    {t?.kind === "schedule" && r.days !== null ? ` (${r.days} días)` : ""}
                    {r.conditions.length > 0 &&
                      ` · ${r.conditions.length} condición${r.conditions.length > 1 ? "es" : ""}`}
                    {" · "}
                    <span className="text-foreground">Hace:</span>{" "}
                    {r.actions.map((a) => ACTION_TYPE_LABELS[a.type as ActionType]).join(", ")}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {r.runCount} ejecución(es){r.lastRunLabel ? ` · última ${r.lastRunLabel}` : ""} · actúa
                    como {r.actsAs}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <label className="mr-2 flex items-center gap-1.5 text-xs">
                    <Checkbox
                      checked={r.enabled}
                      disabled={pending}
                      onChange={(e) =>
                        run(
                          () => setRuleEnabledAction(r.id, e.target.checked),
                          e.target.checked ? "Automatización activada" : "Automatización pausada",
                        )
                      }
                    />
                    Activa
                  </label>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Editar"
                    onClick={() =>
                      open({
                        id: r.id,
                        name: r.name,
                        enabled: r.enabled,
                        trigger: r.trigger,
                        days: r.days,
                        conditions: r.conditions,
                        actions: r.actions,
                      })
                    }
                  >
                    <Pencil />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="text-danger"
                    aria-label="Eliminar"
                    disabled={pending}
                    onClick={() => {
                      if (window.confirm(`¿Eliminar «${r.name}»? El historial se conserva.`))
                        run(() => deleteRuleAction(r.id), "Automatización eliminada");
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            );
          })}
        </Card>
      )}

      <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
        <Sparkles className="size-4" /> Sugeridas
      </h2>
      <div className="mb-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {RULE_TEMPLATES.map((t) => (
          <button
            key={t.key}
            type="button"
            className="rounded-lg border bg-surface p-4 text-left hover:border-primary"
            onClick={() =>
              open({
                name: t.name,
                enabled: true,
                trigger: t.trigger,
                days: t.days ?? null,
                conditions: t.conditions,
                actions: t.actions,
              })
            }
          >
            <p className="text-sm font-medium">{t.name}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t.description}</p>
          </button>
        ))}
      </div>

      {editing && (
        <RuleEditor
          key={editorKey}
          open
          onOpenChange={(v) => !v && setEditing(null)}
          initial={editing}
          options={options}
        />
      )}
    </>
  );
}
