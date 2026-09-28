"use client";

import { Pencil, Plus, UsersRound } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { getTeamMembersAction, saveTeamAction, setTeamMembersAction } from "./actions";

export interface TeamLookups {
  branches: { id: string; name: string }[];
  members: { membershipId: string; name: string; email: string }[];
}

export interface TeamRow {
  id: string;
  name: string;
  branchId: string;
  leadMembershipId: string | null;
  isActive: boolean;
}

function TeamForm({
  initial,
  lookups,
  onDone,
}: {
  initial?: TeamRow;
  lookups: TeamLookups;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const payload = {
      ...(initial ? { id: initial.id } : {}),
      name: String(f.get("name") ?? ""),
      branchId: String(f.get("branchId") ?? ""),
      leadMembershipId: String(f.get("leadMembershipId") ?? "") || null,
      isActive: initial ? f.get("isActive") === "on" : true,
    };
    startTransition(async () => {
      const result = await saveTeamAction(payload);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        return void toast.error(result.error);
      }
      toast.success(initial ? "Equipo actualizado" : "Equipo creado");
      onDone();
    });
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <Field label="Nombre" htmlFor="t-name" error={errors.name}>
        <Input id="t-name" name="name" defaultValue={initial?.name} required />
      </Field>
      <Field label="Sucursal" htmlFor="t-branch" error={errors.branchId}>
        <Select id="t-branch" name="branchId" defaultValue={initial?.branchId ?? ""} required>
          <option value="" disabled>
            Elegí una sucursal
          </option>
          {lookups.branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label="Responsable"
        htmlFor="t-lead"
        error={errors.leadMembershipId}
        hint="Se agrega automáticamente como miembro"
      >
        <Select id="t-lead" name="leadMembershipId" defaultValue={initial?.leadMembershipId ?? ""}>
          <option value="">Sin responsable</option>
          {lookups.members.map((m) => (
            <option key={m.membershipId} value={m.membershipId}>
              {m.name}
            </option>
          ))}
        </Select>
      </Field>
      {initial && (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox name="isActive" defaultChecked={initial.isActive} /> Equipo activo
        </label>
      )}
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onDone} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" loading={pending}>
          {initial ? "Guardar cambios" : "Crear equipo"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function NewTeamButton({ lookups }: { lookups: TeamLookups }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)} disabled={lookups.branches.length === 0}>
        <Plus /> Nuevo equipo
      </Button>
      <DialogContent title="Nuevo equipo">
        {open && <TeamForm lookups={lookups} onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function MembersEditor({
  team,
  lookups,
  onDone,
}: {
  team: TeamRow;
  lookups: TeamLookups;
  onDone: () => void;
}) {
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [filter, setFilter] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    void getTeamMembersAction(team.id).then((result) => {
      if (cancelled) return;
      if (!result.ok) return void toast.error(result.error);
      setSelected(new Set(result.data));
    });
    return () => {
      cancelled = true;
    };
  }, [team.id]);

  const visible = useMemo(
    () =>
      lookups.members.filter((m) =>
        `${m.name} ${m.email}`.toLowerCase().includes(filter.trim().toLowerCase()),
      ),
    [lookups.members, filter],
  );

  const save = () =>
    startTransition(async () => {
      const result = await setTeamMembersAction({ teamId: team.id, membershipIds: [...(selected ?? [])] });
      if (!result.ok) return void toast.error(result.error);
      toast.success("Miembros actualizados");
      onDone();
    });

  return (
    <div className="grid gap-3">
      <Input
        placeholder="Filtrar usuarios"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        aria-label="Filtrar usuarios"
      />
      <div className="max-h-72 divide-y overflow-y-auto rounded-md border">
        {selected === null ? (
          <p className="p-4 text-sm text-muted-foreground">Cargando…</p>
        ) : (
          visible.map((m) => {
            const isLead = m.membershipId === team.leadMembershipId;
            return (
              <label key={m.membershipId} className="flex items-center gap-3 px-3 py-2 text-sm">
                <Checkbox
                  checked={isLead || selected.has(m.membershipId)}
                  disabled={isLead}
                  onChange={(e) =>
                    setSelected((s) => {
                      const next = new Set(s);
                      if (e.target.checked) next.add(m.membershipId);
                      else next.delete(m.membershipId);
                      return next;
                    })
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{m.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{m.email}</span>
                </span>
                {isLead && <span className="text-xs text-muted-foreground">Responsable</span>}
              </label>
            );
          })
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onDone} disabled={pending}>
          Cancelar
        </Button>
        <Button onClick={save} loading={pending} disabled={selected === null}>
          Guardar miembros
        </Button>
      </DialogFooter>
    </div>
  );
}

export function TeamRowActions({ team, lookups }: { team: TeamRow; lookups: TeamLookups }) {
  const [editOpen, setEditOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  return (
    <div className="flex justify-end gap-1">
      <Dialog open={membersOpen} onOpenChange={setMembersOpen}>
        <Button variant="ghost" size="sm" onClick={() => setMembersOpen(true)}>
          <UsersRound /> Miembros
        </Button>
        <DialogContent title={`Miembros de ${team.name}`}>
          {membersOpen && (
            <MembersEditor team={team} lookups={lookups} onDone={() => setMembersOpen(false)} />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Editar ${team.name}`}
          onClick={() => setEditOpen(true)}
        >
          <Pencil />
        </Button>
        <DialogContent title="Editar equipo">
          {editOpen && <TeamForm initial={team} lookups={lookups} onDone={() => setEditOpen(false)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
