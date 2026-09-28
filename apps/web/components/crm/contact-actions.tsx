"use client";

import { GitMerge, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteContactAction, dismissDuplicateAction, mergeContactsAction } from "@/app/(app)/crm/actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";

export function DeleteContactButton({ contactId, name }: { contactId: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="ghost" className="text-danger">
          <Trash2 /> Dar de baja
        </Button>
      }
      title={`¿Dar de baja a ${name}?`}
      description="Deja de aparecer en listados y búsquedas. Su historial se conserva en la auditoría. No se puede si tiene leads abiertos."
      confirmLabel="Dar de baja"
      loading={pending}
      onConfirm={() =>
        startTransition(async () => {
          const r = await deleteContactAction(contactId);
          if (!r.ok) return void toast.error(r.error);
          toast.success("Contacto dado de baja");
          router.push("/crm/contacts");
        })
      }
    />
  );
}

const REASONS: Record<string, string> = {
  document: "mismo documento",
  phone: "mismo teléfono",
  email: "mismo email",
  name: "nombre parecido",
};

export function DuplicateRow({
  candidateId,
  currentId,
  currentName,
  other,
  reasons,
  canMerge,
}: {
  candidateId: string;
  currentId: string;
  currentName: string;
  other: { id: string | null; name: string };
  reasons: string[];
  canMerge: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const merge = () =>
    startTransition(async () => {
      if (!other.id) return;
      const r = await mergeContactsAction({ survivorId: currentId, mergedId: other.id });
      if (!r.ok) return void toast.error(r.error);
      toast.success("Contactos fusionados");
      setOpen(false);
      router.refresh();
    });

  const dismiss = () =>
    startTransition(async () => {
      const r = await dismissDuplicateAction(candidateId);
      if (!r.ok) return void toast.error(r.error);
      toast.success("Marcado como no duplicado");
      router.refresh();
    });

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-1.5">
      <span>
        {other.id ? (
          <Link href={`/crm/contacts/${other.id}`} className="font-medium hover:underline">
            {other.name}
          </Link>
        ) : (
          <span className="font-medium">{other.name}</span>
        )}{" "}
        <span className="text-muted-foreground">— {reasons.map((r) => REASONS[r] ?? r).join(", ")}</span>
      </span>
      {canMerge && other.id && (
        <span className="flex gap-1">
          <ConfirmDialog
            open={open}
            onOpenChange={setOpen}
            trigger={
              <Button size="sm" variant="secondary">
                <GitMerge /> Fusionar aquí
              </Button>
            }
            title="¿Fusionar contactos?"
            description={
              <>
                <strong>{other.name}</strong> se integra en <strong>{currentName}</strong>: se mueven sus
                teléfonos, emails, leads, timeline, etiquetas y datos de propietario, y se completan los
                campos vacíos. El contacto fusionado queda dado de baja y registrado en la auditoría.
              </>
            }
            confirmLabel="Fusionar"
            tone="primary"
            onConfirm={merge}
            loading={pending}
          />
          <Button size="sm" variant="ghost" onClick={dismiss} disabled={pending}>
            <X /> No es duplicado
          </Button>
        </span>
      )}
    </li>
  );
}
