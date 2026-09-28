"use client";

import { CalendarPlus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { EventFormDialog, type EventFormDefaults } from "./event-form-dialog";

/** "Agendar" desde una ficha: abre el alta con el cliente o la propiedad ya vinculados. */
export function ScheduleButton({
  tz,
  defaults,
  assignees,
  label = "Agendar",
  variant = "secondary",
}: {
  tz: string;
  defaults: EventFormDefaults;
  assignees?: { userId: string; name: string }[] | null;
  label?: string;
  variant?: "primary" | "secondary";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant={variant} onClick={() => setOpen(true)}>
        <CalendarPlus /> {label}
      </Button>
      <EventFormDialog open={open} onOpenChange={setOpen} tz={tz} defaults={defaults} assignees={assignees} />
    </>
  );
}
