"use client";

import {
  BarChart3,
  Briefcase,
  Calculator,
  Building2,
  CalendarDays,
  ChevronDown,
  FileText,
  KeyRound,
  LayoutDashboard,
  MessagesSquare,
  Settings2,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { IconName } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import type { VisibleNavSection } from "./nav-types";

export const ICONS: Record<IconName, LucideIcon> = {
  dashboard: LayoutDashboard,
  users: Users,
  building: Building2,
  briefcase: Briefcase,
  key: KeyRound,
  message: MessagesSquare,
  calendar: CalendarDays,
  file: FileText,
  wallet: Wallet,
  settings: Settings2,
  chart: BarChart3,
  calculator: Calculator,
};

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function PhaseTag({ phase }: { phase: number | null | undefined }) {
  if (phase == null) return null;
  return (
    <span
      className="ml-auto rounded bg-surface-muted px-1 text-[10px] font-medium text-muted-foreground tabular"
      title={`Se construye en la Fase ${phase}`}
    >
      F{phase}
    </span>
  );
}

export function SidebarNav({
  sections,
  onNavigate,
}: {
  sections: VisibleNavSection[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  return (
    <nav aria-label="Navegación principal" className="flex flex-col gap-0.5 px-3 py-3 text-sm">
      {sections.map((section) => {
        const Icon = ICONS[section.icon];
        if (section.href) {
          const active = isActive(pathname, section.href);
          return (
            <Link
              key={section.key}
              href={section.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-8 items-center gap-2.5 rounded-md px-2 font-medium text-foreground/85 hover:bg-surface-muted",
                active && "bg-sidebar-active text-foreground",
              )}
            >
              <Icon className="size-4 text-muted-foreground" aria-hidden />
              {section.label}
              <PhaseTag phase={section.plannedPhase} />
            </Link>
          );
        }
        const open = !collapsed[section.key];
        return (
          <div key={section.key} className="mt-2">
            <button
              type="button"
              onClick={() => setCollapsed((c) => ({ ...c, [section.key]: open }))}
              aria-expanded={open}
              className="flex h-8 w-full items-center gap-2.5 rounded-md px-2 font-medium text-foreground/85 hover:bg-surface-muted"
            >
              <Icon className="size-4 text-muted-foreground" aria-hidden />
              {section.label}
              <ChevronDown
                className={cn(
                  "ml-auto size-3.5 text-muted-foreground transition-transform",
                  !open && "-rotate-90",
                )}
                aria-hidden
              />
            </button>
            {open && (
              <ul className="mt-0.5 ml-4 border-l pl-2">
                {section.items.map((item) => {
                  const active = isActive(pathname, item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex h-7 items-center rounded-md px-2 text-muted-foreground hover:bg-surface-muted hover:text-foreground",
                          active && "bg-sidebar-active font-medium text-foreground",
                        )}
                      >
                        {item.label}
                        <PhaseTag phase={item.plannedPhase} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}
