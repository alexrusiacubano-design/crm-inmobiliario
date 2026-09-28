"use client";

import { Lock, ShieldAlert, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  PERMISSION_DEFS,
  PERMISSION_MODULE_LABELS,
  SCOPE_LABELS,
  SCOPES,
  type PermissionCode,
  type Scope,
} from "@crm/shared/rbac";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { Badge, Card } from "@/components/ui/misc";
import { deleteRoleAction, saveRoleAction } from "./actions";

interface Props {
  role?: {
    id: string;
    name: string;
    description: string | null;
    isSystem: boolean;
    isLocked: boolean;
    grants: { code: string; scope: Scope }[];
  };
  memberCount?: number;
}

const MODULES = [...new Set(PERMISSION_DEFS.map((p) => p.module))];

export function RoleEditor({ role, memberCount = 0 }: Props) {
  const router = useRouter();
  const readOnly = !!role?.isLocked;
  const [grants, setGrants] = useState<Map<PermissionCode, Scope>>(
    () => new Map((role?.grants ?? []).map((g) => [g.code as PermissionCode, g.scope])),
  );
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();
  const [deleting, startDelete] = useTransition();

  const countByModule = useMemo(() => {
    const out: Record<string, number> = {};
    for (const p of PERMISSION_DEFS) if (grants.has(p.code)) out[p.module] = (out[p.module] ?? 0) + 1;
    return out;
  }, [grants]);

  const toggle = (code: PermissionCode, on: boolean) =>
    setGrants((g) => {
      const next = new Map(g);
      if (on) next.set(code, "org");
      else next.delete(code);
      return next;
    });

  const setScope = (code: PermissionCode, scope: Scope) => setGrants((g) => new Map(g).set(code, scope));

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const payload = {
      ...(role ? { id: role.id } : {}),
      name: String(f.get("name") ?? ""),
      description: String(f.get("description") ?? ""),
      grants: [...grants.entries()].map(([code, scope]) => ({ code, scope })),
    };
    startTransition(async () => {
      const result = await saveRoleAction(payload);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        return void toast.error(result.error);
      }
      toast.success(role ? "Rol actualizado" : "Rol creado");
      router.push("/admin/roles");
    });
  }

  const remove = () =>
    startDelete(async () => {
      if (!role) return;
      const result = await deleteRoleAction(role.id);
      if (!result.ok) return void toast.error(result.error);
      toast.success("Rol eliminado");
      router.push("/admin/roles");
    });

  return (
    <form onSubmit={onSubmit} className="grid gap-6" noValidate>
      {readOnly && (
        <p className="flex items-center gap-2 rounded-md bg-surface-muted px-3 py-2 text-sm text-muted-foreground">
          <Lock className="size-4" /> Este rol está bloqueado: siempre tiene todos los permisos y no se puede
          editar.
        </p>
      )}
      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Nombre" htmlFor="r-name" error={errors.name}>
          <Input id="r-name" name="name" defaultValue={role?.name} required disabled={readOnly} />
        </Field>
        <Field label="Descripción" htmlFor="r-desc" error={errors.description}>
          <Textarea
            id="r-desc"
            name="description"
            rows={1}
            defaultValue={role?.description ?? ""}
            disabled={readOnly}
          />
        </Field>
      </Card>

      <div className="grid gap-4">
        <div>
          <h2 className="text-sm font-semibold">Permisos</h2>
          <p className="text-sm text-muted-foreground">
            El alcance define sobre qué registros aplica: propios, del equipo, de la sucursal o de toda la
            organización. Solo podés otorgar permisos que vos mismo tenés.
          </p>
        </div>
        {MODULES.map((module) => (
          <Card key={module}>
            <div className="flex items-center justify-between border-b px-4 py-2.5">
              <h3 className="text-sm font-medium">{PERMISSION_MODULE_LABELS[module] ?? module}</h3>
              <span className="text-xs text-muted-foreground tabular">
                {countByModule[module] ?? 0} / {PERMISSION_DEFS.filter((p) => p.module === module).length}
              </span>
            </div>
            <ul className="divide-y">
              {PERMISSION_DEFS.filter((p) => p.module === module).map((p) => {
                const scope = grants.get(p.code);
                const id = `perm-${p.code}`;
                return (
                  <li key={p.code} className="flex flex-wrap items-center gap-3 px-4 py-2">
                    <Checkbox
                      id={id}
                      checked={!!scope}
                      disabled={readOnly}
                      onChange={(e) => toggle(p.code, e.target.checked)}
                    />
                    <label htmlFor={id} className="min-w-0 flex-1 text-sm">
                      {p.label}
                      {p.sensitive && (
                        <Badge tone="warning" className="ml-2 align-middle">
                          <ShieldAlert className="size-3" /> Sensible
                        </Badge>
                      )}
                      <span className="block font-mono text-[11px] text-muted-foreground">{p.code}</span>
                    </label>
                    {scope &&
                      (p.scopable ? (
                        <Select
                          aria-label={`Alcance de ${p.label}`}
                          value={scope}
                          disabled={readOnly}
                          onChange={(e) => setScope(p.code, e.target.value as Scope)}
                          className="h-8 w-auto min-w-48 text-xs"
                        >
                          {SCOPES.map((s) => (
                            <option key={s} value={s}>
                              {SCOPE_LABELS[s]}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <span className="text-xs text-muted-foreground">Toda la organización</span>
                      ))}
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
      </div>

      <div className="sticky bottom-0 -mx-4 flex items-center justify-between gap-3 border-t bg-background/90 px-4 py-3 backdrop-blur lg:-mx-8 lg:px-8">
        <div>
          {role && !role.isSystem && (
            <ConfirmDialog
              trigger={
                <Button
                  type="button"
                  variant="ghost"
                  className="text-danger"
                  disabled={memberCount > 0}
                  title={memberCount > 0 ? "Quitá primero el rol a sus usuarios" : undefined}
                >
                  <Trash2 /> Eliminar rol
                </Button>
              }
              title={`¿Eliminar el rol ${role.name}?`}
              description="El rol deja de estar disponible. Queda registrado en la auditoría."
              confirmLabel="Eliminar"
              onConfirm={remove}
              loading={deleting}
            />
          )}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" asChild>
            <Link href="/admin/roles">{readOnly ? "Volver" : "Cancelar"}</Link>
          </Button>
          {!readOnly && (
            <Button type="submit" loading={pending}>
              {role ? "Guardar cambios" : "Crear rol"}
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
