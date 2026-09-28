"use client";

import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { cn } from "@/lib/utils";

/**
 * Controles de listados server-side: la búsqueda y la página viven en la URL, el servidor
 * consulta solo la página pedida. Nunca se carga el dataset completo en el navegador.
 */
export function SearchBox({
  placeholder = "Buscar…",
  className,
}: {
  placeholder?: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const initial = params.get("q") ?? "";
  const [value, setValue] = useState(initial);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (value === initial) return;
    const handle = setTimeout(() => {
      const next = new URLSearchParams(params);
      if (value) next.set("q", value);
      else next.delete("q");
      next.delete("page");
      startTransition(() => router.replace(`${pathname}?${next.toString()}`));
    }, 300);
    return () => clearTimeout(handle);
  }, [value, initial, params, pathname, router]);

  return (
    <div className={cn("relative w-full max-w-xs", className)}>
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        type="search"
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={cn("pl-8", pending && "opacity-70")}
      />
    </div>
  );
}

export function Pagination({ page, pageSize, total }: { page: number; pageSize: number; total: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  const go = (target: number) => {
    const next = new URLSearchParams(params);
    next.set("page", String(target));
    router.push(`${pathname}?${next.toString()}`);
  };

  return (
    <div className="flex items-center justify-between gap-4 border-t px-4 py-2.5 text-sm text-muted-foreground">
      <span className="tabular">
        {from}–{to} de {total}
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Página anterior"
          disabled={page <= 1}
          onClick={() => go(page - 1)}
        >
          <ChevronLeft />
        </Button>
        <span className="tabular px-2">
          {page} / {pages}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Página siguiente"
          disabled={page >= pages}
          onClick={() => go(page + 1)}
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
