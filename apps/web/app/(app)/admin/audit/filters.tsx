"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/form";

export function AuditFilters({
  actions,
  entities,
}: {
  actions: [string, string][];
  entities: [string, string][];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    router.replace(`${pathname}?${next.toString()}`);
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Select
        aria-label="Filtrar por entidad"
        value={params.get("entityType") ?? ""}
        onChange={(e) => set("entityType", e.target.value)}
        className="w-44"
      >
        <option value="">Todas las entidades</option>
        {entities.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>
      <Select
        aria-label="Filtrar por acción"
        value={params.get("action") ?? ""}
        onChange={(e) => set("action", e.target.value)}
        className="w-60"
      >
        <option value="">Todas las acciones</option>
        {actions.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>
    </div>
  );
}
