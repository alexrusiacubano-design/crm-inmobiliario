"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  ACTION_TYPE_LABELS,
  ACTION_TYPES,
  AUTOMATION_TRIGGER_KEYS,
  AUTOMATION_TRIGGERS,
  AUTOMATION_VARIABLES,
  CONDITION_OP_LABELS,
  ENTITY_FIELDS,
  RECIPIENT_LABELS,
  actionAllowed,
  opsFor,
  type ActionType,
  type AutomationTrigger,
  type Condition,
  type ConditionOp,
} from "@crm/shared/automations";
import { saveRuleAction } from "@/app/(app)/admin/automations/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";

export interface RuleDraft {
  id?: string | null;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  days: number | null;
  conditions: Condition[];
  actions: Record<string, unknown>[];
}

export interface EditorOptions {
  users: { userId: string; name: string }[];
  roles: { key: string; name: string }[];
}

function blankAction(type: ActionType): Record<string, unknown> {
  switch (type) {
    case "notify":
      return { type, to: "assignee", title: "", body: "" };
    case "task":
      return { type, to: "assignee", title: "", dueInDays: 1 };
    case "assign":
      return { type, userIds: [] };
    case "tag":
      return { type, tag: "" };
    case "webhook":
      return { type, url: "" };
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));

export function RuleEditor({
  open,
  onOpenChange,
  initial,
  options,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: RuleDraft;
  options: EditorOptions;
}) {
  const router = useRouter();
  const [r, setR] = useState<RuleDraft>(initial);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  const def = AUTOMATION_TRIGGERS[r.trigger];
  const fields = ENTITY_FIELDS[def.entity];
  const err = (k: string) => errors[k]?.[0];

  const setAction = (i: number, patch: Record<string, unknown>) =>
    setR((p) => ({ ...p, actions: p.actions.map((a, j) => (j === i ? { ...a, ...patch } : a)) }));
  const setCond = (i: number, patch: Partial<Condition>) =>
    setR((p) => ({ ...p, conditions: p.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl"
        title={r.id ? "Editar automatización" : "Nueva automatización"}
        description="Cuando pasa algo (disparador) y se cumplen las condiciones, el CRM ejecuta las acciones. Se ejecuta con tus permisos."
      >
        <form
          className="grid gap-5"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await saveRuleAction({ ...r, days: def.kind === "schedule" ? r.days : null });
              if (!res.ok) {
                setErrors(res.fieldErrors ?? {});
                return void toast.error(res.error);
              }
              toast.success("Automatización guardada");
              onOpenChange(false);
              router.refresh();
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <Field label="Nombre" htmlFor="ar-name" error={errors.name}>
              <Input id="ar-name" value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <Checkbox checked={r.enabled} onChange={(e) => setR({ ...r, enabled: e.target.checked })} />
              Activa
            </label>
          </div>

          <fieldset className="grid gap-3 rounded-md border p-3">
            <legend className="px-1 text-sm font-semibold">1. Cuándo</legend>
            <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
              <Field label="Disparador" htmlFor="ar-trigger">
                <Select
                  id="ar-trigger"
                  value={r.trigger}
                  onChange={(e) => {
                    const t = e.target.value as AutomationTrigger;
                    const nd = AUTOMATION_TRIGGERS[t];
                    setR((p) => ({
                      ...p,
                      trigger: t,
                      days: nd.kind === "schedule" ? (p.days ?? nd.defaultDays ?? 1) : null,
                      conditions: nd.entity === def.entity ? p.conditions : [],
                      actions: p.actions.filter((a) => actionAllowed(a.type as ActionType, nd.entity)),
                    }));
                  }}
                >
                  <optgroup label="Cuando pasa algo">
                    {AUTOMATION_TRIGGER_KEYS.filter((k) => AUTOMATION_TRIGGERS[k].kind === "event").map(
                      (k) => (
                        <option key={k} value={k}>
                          {AUTOMATION_TRIGGERS[k].label}
                        </option>
                      ),
                    )}
                  </optgroup>
                  <optgroup label="Revisión periódica (cada hora)">
                    {AUTOMATION_TRIGGER_KEYS.filter((k) => AUTOMATION_TRIGGERS[k].kind === "schedule").map(
                      (k) => (
                        <option key={k} value={k}>
                          {AUTOMATION_TRIGGERS[k].label}
                        </option>
                      ),
                    )}
                  </optgroup>
                </Select>
              </Field>
              {def.kind === "schedule" && "daysLabel" in def && (
                <Field label={def.daysLabel} htmlFor="ar-days" error={errors.days}>
                  <Input
                    id="ar-days"
                    inputMode="numeric"
                    value={r.days ?? ""}
                    onChange={(e) =>
                      setR({ ...r, days: e.target.value === "" ? null : Number(e.target.value) })
                    }
                  />
                </Field>
              )}
            </div>
          </fieldset>

          <fieldset className="grid gap-3 rounded-md border p-3">
            <legend className="px-1 text-sm font-semibold">2. Si se cumple (opcional)</legend>
            {r.conditions.length === 0 && (
              <p className="text-xs text-muted-foreground">Sin condiciones: se ejecuta siempre.</p>
            )}
            {r.conditions.map((c, i) => {
              const f = fields.find((x) => x.key === c.field) ?? fields[0];
              if (!f) return null;
              return (
                <div
                  key={i}
                  className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1.2fr_0.9fr_1.2fr_auto]"
                >
                  <Select
                    aria-label="Campo"
                    value={c.field}
                    onChange={(e) => {
                      const nf = fields.find((x) => x.key === e.target.value);
                      if (!nf) return;
                      setCond(i, {
                        field: nf.key,
                        op: opsFor(nf.type)[0],
                        value:
                          nf.type === "boolean" ? "true" : nf.type === "enum" ? (nf.options?.[0] ?? "") : "",
                      });
                    }}
                  >
                    {fields.map((x) => (
                      <option key={x.key} value={x.key}>
                        {x.label}
                      </option>
                    ))}
                  </Select>
                  <Select
                    aria-label="Operador"
                    value={c.op}
                    onChange={(e) => setCond(i, { op: e.target.value as ConditionOp })}
                  >
                    {opsFor(f.type).map((o) => (
                      <option key={o} value={o}>
                        {CONDITION_OP_LABELS[o]}
                      </option>
                    ))}
                  </Select>
                  {f.type === "enum" ? (
                    <Select
                      aria-label="Valor"
                      value={str(c.value)}
                      onChange={(e) => setCond(i, { value: e.target.value })}
                    >
                      {f.options?.map((o) => (
                        <option key={o} value={o}>
                          {f.optionLabels?.[o] ?? o}
                        </option>
                      ))}
                    </Select>
                  ) : f.type === "boolean" ? (
                    <Select
                      aria-label="Valor"
                      value={str(c.value)}
                      onChange={(e) => setCond(i, { value: e.target.value })}
                    >
                      <option value="true">Sí</option>
                      <option value="false">No</option>
                    </Select>
                  ) : (
                    <Input
                      aria-label="Valor"
                      inputMode="numeric"
                      value={str(c.value)}
                      onChange={(e) => setCond(i, { value: e.target.value })}
                    />
                  )}
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label="Quitar condición"
                    onClick={() =>
                      setR((p) => ({ ...p, conditions: p.conditions.filter((_, j) => j !== i) }))
                    }
                  >
                    <Trash2 />
                  </Button>
                  {err(`conditions.${i}.value`) && (
                    <p className="col-span-full text-xs text-danger">{err(`conditions.${i}.value`)}</p>
                  )}
                </div>
              );
            })}
            <div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={r.conditions.length >= 10}
                onClick={() => {
                  const f = fields[0];
                  if (!f) return;
                  setR((p) => ({
                    ...p,
                    conditions: [
                      ...p.conditions,
                      {
                        field: f.key,
                        op: opsFor(f.type)[0] ?? "eq",
                        value:
                          f.type === "enum" ? (f.options?.[0] ?? "") : f.type === "boolean" ? "true" : "",
                      },
                    ],
                  }));
                }}
              >
                <Plus /> Agregar condición
              </Button>
            </div>
          </fieldset>

          <fieldset className="grid gap-3 rounded-md border p-3">
            <legend className="px-1 text-sm font-semibold">3. Hacer</legend>
            {err("actions") && <p className="text-xs text-danger">{err("actions")}</p>}
            {r.actions.map((a, i) => {
              const type = a.type as ActionType;
              const e = (k: string) => err(`actions.${i}.${k}`);
              return (
                <div key={i} className="grid gap-3 rounded-md bg-surface-muted/50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{ACTION_TYPE_LABELS[type]}</span>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Quitar acción"
                      onClick={() => setR((p) => ({ ...p, actions: p.actions.filter((_, j) => j !== i) }))}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  {(type === "notify" || type === "task") && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Para" htmlFor={`a${i}-to`}>
                        <Select
                          id={`a${i}-to`}
                          value={str(a.to)}
                          onChange={(ev) => setAction(i, { to: ev.target.value })}
                        >
                          {(type === "notify"
                            ? (["assignee", "role", "user"] as const)
                            : (["assignee", "user"] as const)
                          ).map((x) => (
                            <option key={x} value={x}>
                              {RECIPIENT_LABELS[x]}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      {a.to === "role" && (
                        <Field
                          label="Rol"
                          htmlFor={`a${i}-role`}
                          error={e("roleKey") ? [e("roleKey") ?? ""] : undefined}
                        >
                          <Select
                            id={`a${i}-role`}
                            value={str(a.roleKey)}
                            onChange={(ev) => setAction(i, { roleKey: ev.target.value })}
                          >
                            <option value="">Elegí…</option>
                            {options.roles.map((x) => (
                              <option key={x.key} value={x.key}>
                                {x.name}
                              </option>
                            ))}
                          </Select>
                        </Field>
                      )}
                      {a.to === "user" && (
                        <Field
                          label="Usuario"
                          htmlFor={`a${i}-user`}
                          error={e("userId") ? [e("userId") ?? ""] : undefined}
                        >
                          <Select
                            id={`a${i}-user`}
                            value={str(a.userId)}
                            onChange={(ev) => setAction(i, { userId: ev.target.value || null })}
                          >
                            <option value="">Elegí…</option>
                            {options.users.map((x) => (
                              <option key={x.userId} value={x.userId}>
                                {x.name}
                              </option>
                            ))}
                          </Select>
                        </Field>
                      )}
                      <Field
                        label={type === "task" ? "Título de la tarea" : "Título"}
                        htmlFor={`a${i}-title`}
                        error={e("title") ? [e("title") ?? ""] : undefined}
                        className="sm:col-span-2"
                      >
                        <Input
                          id={`a${i}-title`}
                          value={str(a.title)}
                          onChange={(ev) => setAction(i, { title: ev.target.value })}
                        />
                      </Field>
                      {type === "notify" ? (
                        <Field label="Detalle (opcional)" htmlFor={`a${i}-body`} className="sm:col-span-2">
                          <Textarea
                            id={`a${i}-body`}
                            rows={2}
                            value={str(a.body)}
                            onChange={(ev) => setAction(i, { body: ev.target.value })}
                          />
                        </Field>
                      ) : (
                        <Field label="Vence en (días)" htmlFor={`a${i}-due`}>
                          <Input
                            id={`a${i}-due`}
                            inputMode="numeric"
                            value={str(a.dueInDays)}
                            onChange={(ev) => setAction(i, { dueInDays: ev.target.value })}
                          />
                        </Field>
                      )}
                    </div>
                  )}
                  {type === "assign" && (
                    <div className="grid gap-1">
                      <p className="text-xs text-muted-foreground">
                        Cada lead nuevo va al siguiente de la lista (en el orden marcado).
                      </p>
                      <div className="grid gap-1 sm:grid-cols-2">
                        {options.users.map((u) => {
                          const ids = (a.userIds as string[]) ?? [];
                          const on = ids.includes(u.userId);
                          return (
                            <label key={u.userId} className="flex items-center gap-2 text-sm">
                              <Checkbox
                                checked={on}
                                onChange={() =>
                                  setAction(i, {
                                    userIds: on ? ids.filter((x) => x !== u.userId) : [...ids, u.userId],
                                  })
                                }
                              />
                              {u.name}
                              {on && (
                                <span className="text-xs text-muted-foreground">
                                  #{ids.indexOf(u.userId) + 1}
                                </span>
                              )}
                            </label>
                          );
                        })}
                      </div>
                      {e("userIds") && <p className="text-xs text-danger">{e("userIds")}</p>}
                    </div>
                  )}
                  {type === "tag" && (
                    <Field
                      label="Etiqueta"
                      htmlFor={`a${i}-tag`}
                      error={e("tag") ? [e("tag") ?? ""] : undefined}
                    >
                      <Input
                        id={`a${i}-tag`}
                        value={str(a.tag)}
                        onChange={(ev) => setAction(i, { tag: ev.target.value })}
                      />
                    </Field>
                  )}
                  {type === "webhook" && (
                    <Field
                      label="Dirección (https)"
                      htmlFor={`a${i}-url`}
                      error={e("url") ? [e("url") ?? ""] : undefined}
                      hint="Recibe un POST JSON firmado (X-CRM-Signature, HMAC-SHA256). Sirve para Zapier, Make o n8n."
                    >
                      <Input
                        id={`a${i}-url`}
                        type="url"
                        placeholder="https://hooks.zapier.com/…"
                        value={str(a.url)}
                        onChange={(ev) => setAction(i, { url: ev.target.value })}
                      />
                    </Field>
                  )}
                </div>
              );
            })}
            <div className="flex flex-wrap gap-2">
              {ACTION_TYPES.filter((t) => actionAllowed(t, def.entity)).map((t) => (
                <Button
                  key={t}
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={r.actions.length >= 6}
                  onClick={() => setR((p) => ({ ...p, actions: [...p.actions, blankAction(t)] }))}
                >
                  <Plus /> {ACTION_TYPE_LABELS[t]}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Variables para los textos:{" "}
              {Object.entries(AUTOMATION_VARIABLES).map(([k, label], idx) => (
                <span key={k} title={label}>
                  {idx > 0 && ", "}
                  <code className="rounded bg-surface-muted px-1">{`{{${k}}}`}</code>
                </span>
              ))}
            </p>
          </fieldset>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
