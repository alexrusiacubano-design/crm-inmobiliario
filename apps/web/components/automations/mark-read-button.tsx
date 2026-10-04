"use client";

import { CheckCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { markNotificationsReadAction } from "@/app/(app)/notifications/actions";
import { Button } from "@/components/ui/button";

export function MarkAllReadButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="secondary"
      loading={pending}
      onClick={() =>
        start(async () => {
          await markNotificationsReadAction();
          router.refresh();
        })
      }
    >
      <CheckCheck /> Marcar todas como leídas
    </Button>
  );
}
