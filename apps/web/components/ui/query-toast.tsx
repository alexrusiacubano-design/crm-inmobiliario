"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

/** Muestra un aviso que llega por la URL (por ejemplo, al volver de conectar un portal) y lo limpia. */
export function QueryToast({
  success,
  error,
  path,
}: {
  success?: string | null;
  error?: string | null;
  path: string;
}) {
  const router = useRouter();
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current || (!success && !error)) return;
    shown.current = true;
    if (success) toast.success(success);
    if (error) toast.error(error, { duration: 12_000 });
    router.replace(path);
  }, [success, error, path, router]);
  return null;
}
