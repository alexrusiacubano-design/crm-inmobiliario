"use client";

import { Pencil, Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { MemberSnapshot } from "@crm/core";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { createUserAction, getUserAction, updateUserAction } from "./actions";

export interface UserFormLookups {
  roles: { id: string; name: string; isLocked: boolean; description: string | null }[];
  branches: { id: string; name: string }[];
  teams: { id: string; name: string; branchName: string }[];
  canAssignLocked: boolean;
}

type Errors = Record<string, string[]>;
interface RoleSel {
  roleId: string;
  branchId: string | null;
}

function Form({
  lookups,
  initial,
  onDone,
}: {
  lookups: UserFormLookups;
  initial?: MemberSnapshot;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Errors>({});
  const [roles, setRoles] = useState<RoleSel[]>(
    initial?.roles.map((r) => ({ roleId: r.roleId, branchId: r.branchId })) ?? [],
  );
  const [teamIds, setTeamIds] = useState<string[]>(initial?.teamIds ?? []);

  const toggleRole = (roleId: string, on: boolean) =>
    setRoles((current) =>
      on ? [...current, { roleId, branchId: null }] : current.filter((r) => r.roleId !== roleId),
    );
  const setRoleBranch = (roleId: string, branchId: string) =>
    setRoles((current) =>
      current.map((r) => (r.roleId === roleId ? { ...r, branchId: branchId || null } : r)),
    );

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const base = {
      name: String(form.get("name") ?? ""),
      jobTitle: String(form.get("jobTitle") ?? ""),
      phone: String(form.get("phone") ?? ""),
      defaultBranchId: String(form.get("defaultBranchId") ?? "") || null,
      roles,
      teamIds,
    };
    startTransition(async () => {
      const result = initial
        ? await updateUserAction({ ...base, membershipId: initial.membershipId })
        : await createUserAction({
            ...base,
            email: String(form.get("email") ?? ""),
            password: String(form.get("password") ?? ""),
          });
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast.error(result.error);
        return;
      }
      toast.success(initial ? "Usuario actualizado" : "Usuario creado");
      onDone();
    });
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre completo" htmlFor="name" error={errors.name} className="sm:col-span-2">
          <Input id="name" name="name" defaultValue={initial?.name} required aria-invalid={!!errors.name} />
        </Field>
        {!initial && (
          <>
            <Field label="Email" htmlFor="email" error={errors.email}>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="off"
                required
                aria-invalid={!!errors.email}
              />
            </Field>
            <Field
              label="Contraseña inicial"
              htmlFor="password"
              error={errors.password}
              hint="Mínimo 10 caracteres, letras y números"
            >
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                aria-invalid={!!errors.password}
              />
            </Field>
          </>
        )}
        <Field label="Cargo" htmlFor="jobTitle" error={errors.jobTitle}>
          <Input id="jobTitle" name="jobTitle" defaultValue={initial?.jobTitle ?? ""} />
        </Field>
        <Field label="Teléfono" htmlFor="phone" error={errors.phone}>
          <Input
            id="phone"
            name="phone"
            type="tel"
            defaultValue={initial?.phone ?? ""}
            placeholder="+598 99 123 456"
          />
        </Field>
        <Field
          label="Sucursal principal"
          htmlFor="defaultBranchId"
          error={errors.defaultBranchId}
          className="sm:col-span-2"
        >
          <Select id="defaultBranchId" name="defaultBranchId" defaultValue={initial?.defaultBranchId ?? ""}>
            <option value="">Sin sucursal</option>
            {lookups.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Roles</legend>
        {errors.roles && <p className="text-xs text-danger">{errors.roles[0]}</p>}
        <div className="divide-y rounded-md border">
          {lookups.roles.map((r) => {
            const sel = roles.find((x) => x.roleId === r.id);
            const disabled = r.isLocked && !lookups.canAssignLocked;
            return (
              <div key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <Checkbox
                  id={`role-${r.id}`}
                  checked={!!sel}
                  disabled={disabled}
                  onChange={(e) => toggleRole(r.id, e.target.checked)}
                />
                <label htmlFor={`role-${r.id}`} className="min-w-0 flex-1 text-sm">
                  <span className="font-medium">{r.name}</span>
                  {r.description && (
                    <span className="block truncate text-xs text-muted-foreground">{r.description}</span>
                  )}
                </label>
                {sel && !r.isLocked && (
                  <Select
                    aria-label={`Alcance del rol ${r.name}`}
                    value={sel.branchId ?? ""}
                    onChange={(e) => setRoleBranch(r.id, e.target.value)}
                    className="h-8 w-auto min-w-44 text-xs"
                  >
                    <option value="">Toda la organización</option>
                    {lookups.branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        Solo {b.name}
                      </option>
                    ))}
                  </Select>
                )}
              </div>
            );
          })}
        </div>
      </fieldset>

      {lookups.teams.length > 0 && (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">Equipos</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {lookups.teams.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={teamIds.includes(t.id)}
                  onChange={(e) =>
                    setTeamIds((ids) => (e.target.checked ? [...ids, t.id] : ids.filter((x) => x !== t.id)))
                  }
                />
                {t.name} <span className="text-xs text-muted-foreground">· {t.branchName}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onDone} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" loading={pending}>
          {initial ? "Guardar cambios" : "Crear usuario"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function NewUserButton({ lookups }: { lookups: UserFormLookups }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}>
        <Plus /> Nuevo usuario
      </Button>
      <DialogContent
        title="Nuevo usuario"
        description="El usuario podrá ingresar con este email y la contraseña inicial."
        className="max-w-2xl"
      >
        {open && <Form lookups={lookups} onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}

export function EditUserButton({
  membershipId,
  lookups,
}: {
  membershipId: string;
  lookups: UserFormLookups;
}) {
  const [open, setOpen] = useState(false);
  const [initial, setInitial] = useState<MemberSnapshot | null>(null);
  const [loading, startLoading] = useTransition();

  const openEditor = () =>
    startLoading(async () => {
      const result = await getUserAction(membershipId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setInitial(result.data);
      setOpen(true);
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Editar usuario"
        onClick={openEditor}
        loading={loading}
      >
        {!loading && <Pencil />}
      </Button>
      <DialogContent title="Editar usuario" description={initial?.email} className="max-w-2xl">
        {open && initial && <Form lookups={lookups} initial={initial} onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}
