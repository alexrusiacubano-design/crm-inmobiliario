"use client";

import { Pencil, Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { saveBranchAction } from "./actions";

export interface BranchRow {
  id: string;
  name: string;
  code: string;
  address: string | null;
  phone: string | null;
  isActive: boolean;
}

function BranchForm({ initial, onDone }: { initial?: BranchRow; onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const payload = {
      ...(initial ? { id: initial.id, isActive: initial.isActive } : {}),
      name: String(f.get("name") ?? ""),
      code: String(f.get("code") ?? ""),
      address: String(f.get("address") ?? ""),
      phone: String(f.get("phone") ?? ""),
    };
    startTransition(async () => {
      const result = await saveBranchAction(payload);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        return void toast.error(result.error);
      }
      toast.success(initial ? "Sucursal actualizada" : "Sucursal creada");
      onDone();
    });
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
        <Field label="Nombre" htmlFor="b-name" error={errors.name}>
          <Input id="b-name" name="name" defaultValue={initial?.name} required />
        </Field>
        <Field label="Código" htmlFor="b-code" error={errors.code} hint="Ej.: MVD-POC">
          <Input id="b-code" name="code" defaultValue={initial?.code} required className="uppercase" />
        </Field>
      </div>
      <Field label="Dirección" htmlFor="b-address" error={errors.address}>
        <Input id="b-address" name="address" defaultValue={initial?.address ?? ""} />
      </Field>
      <Field label="Teléfono" htmlFor="b-phone" error={errors.phone}>
        <Input id="b-phone" name="phone" type="tel" defaultValue={initial?.phone ?? ""} />
      </Field>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onDone} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" loading={pending}>
          {initial ? "Guardar cambios" : "Crear sucursal"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function NewBranchButton() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}>
        <Plus /> Nueva sucursal
      </Button>
      <DialogContent title="Nueva sucursal">
        {open && <BranchForm onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}

export function BranchRowActions({ branch }: { branch: BranchRow }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [pending, startTransition] = useTransition();

  const toggle = () =>
    startTransition(async () => {
      const result = await saveBranchAction({
        ...branch,
        address: branch.address ?? "",
        phone: branch.phone ?? "",
        isActive: !branch.isActive,
      });
      if (!result.ok) return void toast.error(result.error);
      toast.success(branch.isActive ? "Sucursal desactivada" : "Sucursal reactivada");
      setConfirm(false);
    });

  return (
    <div className="flex justify-end gap-1">
      <Dialog open={open} onOpenChange={setOpen}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Editar ${branch.name}`}
          onClick={() => setOpen(true)}
        >
          <Pencil />
        </Button>
        <DialogContent title="Editar sucursal">
          {open && <BranchForm initial={branch} onDone={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        trigger={
          <Button variant="ghost" size="sm" className={branch.isActive ? "text-danger" : undefined}>
            {branch.isActive ? "Desactivar" : "Reactivar"}
          </Button>
        }
        title={branch.isActive ? `¿Desactivar ${branch.name}?` : `¿Reactivar ${branch.name}?`}
        description={
          branch.isActive
            ? "No se podrá elegir para nuevos usuarios ni equipos. Los datos y el historial asociados se conservan."
            : "Volverá a estar disponible en los formularios."
        }
        confirmLabel={branch.isActive ? "Desactivar" : "Reactivar"}
        tone={branch.isActive ? "danger" : "primary"}
        onConfirm={toggle}
        loading={pending}
      />
    </div>
  );
}
