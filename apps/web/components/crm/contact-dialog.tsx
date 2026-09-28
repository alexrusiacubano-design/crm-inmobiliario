"use client";

import { Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createContactAction, updateContactAction } from "@/app/(app)/crm/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { ContactFields, emptyContact, toContactPayload, type ContactFormValues } from "./contact-fields";

function ContactForm({
  initial,
  contactId,
  assignees,
  onDone,
}: {
  initial: ContactFormValues;
  contactId?: string;
  assignees?: { userId: string; name: string }[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const payload = toContactPayload(value);
      const result = contactId
        ? await updateContactAction({ ...payload, id: contactId })
        : await createContactAction(payload);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        return void toast.error(result.error);
      }
      if (result.data.duplicates.length) {
        toast.warning(`Guardado. Hay ${result.data.duplicates.length} posible(s) duplicado(s) para revisar.`);
      } else {
        toast.success(contactId ? "Contacto actualizado" : "Contacto creado");
      }
      onDone();
      if (!contactId) router.push(`/crm/contacts/${result.data.id}`);
    });
  };

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <ContactFields value={value} onChange={setValue} errors={errors} assignees={assignees} />
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onDone} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" loading={pending}>
          {contactId ? "Guardar cambios" : "Crear contacto"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function NewContactButton({
  assignees,
  label = "Nuevo contacto",
  initialTags = "",
}: {
  assignees?: { userId: string; name: string }[];
  label?: string;
  initialTags?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}>
        <Plus /> {label}
      </Button>
      <DialogContent
        title={label}
        description="Se revisa automáticamente si ya existe por documento, teléfono, email o nombre."
        className="max-w-2xl"
      >
        {open && (
          <ContactForm
            initial={{ ...emptyContact, tags: initialTags }}
            assignees={assignees}
            onDone={() => setOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

export function EditContactButton({
  contactId,
  initial,
  assignees,
}: {
  contactId: string;
  initial: ContactFormValues;
  assignees?: { userId: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Pencil /> Editar
      </Button>
      <DialogContent title="Editar contacto" className="max-w-2xl">
        {open && (
          <ContactForm
            initial={initial}
            contactId={contactId}
            assignees={assignees}
            onDone={() => setOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
