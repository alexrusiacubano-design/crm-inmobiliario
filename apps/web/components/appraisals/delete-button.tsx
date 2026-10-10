"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { deleteAppraisalAction } from "@/app/(app)/appraisals/actions";
import { Button } from "@/components/ui/button";

export function DeleteAppraisalButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      loading={pending}
      onClick={() => {
        if (!window.confirm("¿Eliminar esta tasación?")) return;
        start(async () => {
          const r = await deleteAppraisalAction(id);
          if (!r.ok) return void toast.error(r.error);
          toast.success("Tasación eliminada");
          router.replace("/appraisals/history");
        });
      }}
    >
      <Trash2 /> Eliminar
    </Button>
  );
}
