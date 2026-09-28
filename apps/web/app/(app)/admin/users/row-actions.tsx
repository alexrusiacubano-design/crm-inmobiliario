"use client";

import * as Menu from "@radix-ui/react-dropdown-menu";
import { KeyRound, MoreHorizontal, UserCheck, UserX } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { resetPasswordAction, setUserStatusAction } from "./actions";

export function UserRowActions({
  membershipId,
  name,
  status,
  isSelf,
}: {
  membershipId: string;
  name: string;
  status: "active" | "suspended";
  isSelf: boolean;
}) {
  const [confirm, setConfirm] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const suspend = status === "active";

  const changeStatus = () =>
    startTransition(async () => {
      const result = await setUserStatusAction({ membershipId, status: suspend ? "suspended" : "active" });
      if (!result.ok) return void toast.error(result.error);
      toast.success(suspend ? `${name} fue suspendido` : `${name} fue reactivado`);
      setConfirm(false);
    });

  const resetPassword = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    startTransition(async () => {
      const result = await resetPasswordAction({ membershipId, password });
      if (!result.ok) {
        setError(result.fieldErrors?.password?.[0] ?? result.error);
        return;
      }
      toast.success("Contraseña actualizada. Se cerraron sus sesiones abiertas.");
      setResetOpen(false);
    });
  };

  return (
    <>
      <Menu.Root>
        <Menu.Trigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Más acciones para ${name}`}>
            <MoreHorizontal />
          </Button>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content align="end" className="z-50 min-w-52 rounded-md border bg-surface p-1 shadow-lg">
            <Menu.Item
              onSelect={() => {
                setError(undefined);
                setResetOpen(true);
              }}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-surface-muted"
            >
              <KeyRound className="size-4 text-muted-foreground" /> Cambiar contraseña
            </Menu.Item>
            {!isSelf && (
              <Menu.Item
                onSelect={() => setConfirm(true)}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-danger outline-none data-[highlighted]:bg-danger-soft"
              >
                {suspend ? <UserX className="size-4" /> : <UserCheck className="size-4" />}
                {suspend ? "Suspender acceso" : "Reactivar acceso"}
              </Menu.Item>
            )}
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={suspend ? `¿Suspender a ${name}?` : `¿Reactivar a ${name}?`}
        description={
          suspend
            ? "No podrá ingresar y se cerrarán sus sesiones abiertas. Sus registros y su historial se conservan."
            : "Podrá volver a ingresar con sus credenciales actuales."
        }
        confirmLabel={suspend ? "Suspender" : "Reactivar"}
        tone={suspend ? "danger" : "primary"}
        onConfirm={changeStatus}
        loading={pending}
      />

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent
          title="Cambiar contraseña"
          description={`Nueva contraseña para ${name}. Se cerrarán sus sesiones abiertas.`}
        >
          <form onSubmit={resetPassword} className="grid gap-4">
            <Field
              label="Nueva contraseña"
              htmlFor={`pwd-${membershipId}`}
              error={error}
              hint="Mínimo 10 caracteres, letras y números"
            >
              <Input
                id={`pwd-${membershipId}`}
                name="password"
                type="password"
                autoComplete="new-password"
                required
              />
            </Field>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setResetOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" loading={pending}>
                Guardar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
