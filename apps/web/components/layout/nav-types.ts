import type { IconName } from "@/lib/navigation";

/** Navegación ya filtrada por permisos y traducida, lista para enviar al cliente. */
export interface VisibleNavItem {
  href: string;
  label: string;
  plannedPhase: number | null;
}

export interface VisibleNavSection {
  key: string;
  label: string;
  icon: IconName;
  href?: string;
  plannedPhase?: number | null;
  items: VisibleNavItem[];
}
