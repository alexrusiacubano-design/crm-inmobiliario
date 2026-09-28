"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Command } from "cmdk";
import { LogOut, Menu as MenuIcon, Monitor, Moon, Search, ShieldCheck, Sun } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";
import { authClient } from "@/lib/auth-client";
import { initials } from "@/lib/utils";
import type { VisibleNavSection } from "./nav-types";
import { SidebarNav } from "./sidebar";

interface TopbarProps {
  orgName: string;
  isDemo: boolean;
  user: { name: string; email: string };
  sections: VisibleNavSection[];
}

/**
 * Paleta de comandos (Ctrl/⌘ + K). En la Fase 1 navega entre módulos; la búsqueda global
 * de registros (contactos, propiedades, contratos…) se conecta en la Fase 2.
 */
function CommandPalette({ sections }: { sections: VisibleNavSection[] }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const entries = sections.flatMap((s) =>
    s.href
      ? [{ href: s.href, label: s.label, group: "General" }]
      : s.items.map((i) => ({ href: i.href, label: i.label, group: s.label })),
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-8 w-full max-w-sm items-center gap-2 rounded-md border bg-surface-muted/60 px-2.5 text-sm text-muted-foreground hover:bg-surface-muted"
      >
        <Search className="size-4" aria-hidden />
        <span className="truncate">Ir a…</span>
        <kbd className="ml-auto hidden rounded border bg-surface px-1.5 font-mono text-[10px] sm:inline">
          Ctrl K
        </kbd>
      </button>
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40" />
          <DialogPrimitive.Content className="fixed left-1/2 top-[15vh] z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 overflow-hidden rounded-lg border bg-surface shadow-xl">
            <DialogPrimitive.Title className="sr-only">Navegación rápida</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              Escribí el nombre de un módulo
            </DialogPrimitive.Description>
            <Command label="Navegación rápida" className="text-sm">
              <div className="flex items-center gap-2 border-b px-3">
                <Search className="size-4 text-muted-foreground" aria-hidden />
                <Command.Input
                  placeholder="Buscar módulo…"
                  className="h-11 w-full bg-transparent outline-none placeholder:text-muted-foreground"
                />
              </div>
              <Command.List className="max-h-80 overflow-y-auto p-1.5">
                <Command.Empty className="px-3 py-6 text-center text-muted-foreground">
                  Sin resultados
                </Command.Empty>
                {[...new Set(entries.map((e) => e.group))].map((group) => (
                  <Command.Group
                    key={group}
                    heading={group}
                    className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground"
                  >
                    {entries
                      .filter((e) => e.group === group)
                      .map((e) => (
                        <Command.Item
                          key={e.href}
                          value={`${group} ${e.label}`}
                          onSelect={() => {
                            setOpen(false);
                            router.push(e.href);
                          }}
                          className="cursor-pointer rounded-md px-2 py-1.5 data-[selected=true]:bg-sidebar-active"
                        >
                          {e.label}
                        </Command.Item>
                      ))}
                  </Command.Group>
                ))}
              </Command.List>
              <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                La búsqueda de contactos, propiedades y contratos llega en la Fase 2.
              </p>
            </Command>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}

function ThemeMenuItems() {
  const { theme, setTheme } = useTheme();
  const options = [
    { value: "light", label: "Claro", icon: Sun },
    { value: "dark", label: "Oscuro", icon: Moon },
    { value: "system", label: "Sistema", icon: Monitor },
  ] as const;
  return (
    <Menu.RadioGroup value={theme} onValueChange={setTheme}>
      {options.map(({ value, label, icon: Icon }) => (
        <Menu.RadioItem
          key={value}
          value={value}
          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-surface-muted data-[state=checked]:font-medium"
        >
          <Icon className="size-4 text-muted-foreground" aria-hidden />
          {label}
        </Menu.RadioItem>
      ))}
    </Menu.RadioGroup>
  );
}

function UserMenu({ user }: { user: TopbarProps["user"] }) {
  const router = useRouter();
  const signOut = async () => {
    await authClient.signOut();
    router.replace("/login");
    router.refresh();
  };
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <button
          type="button"
          aria-label="Menú de usuario"
          className="flex size-8 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary hover:ring-2 hover:ring-border-strong"
        >
          {initials(user.name)}
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-56 rounded-md border bg-surface p-1 shadow-lg"
        >
          <div className="px-2 py-1.5">
            <p className="text-sm font-medium">{user.name}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          </div>
          <Menu.Separator className="my-1 h-px bg-border" />
          <Menu.Label className="px-2 pt-1 text-xs text-muted-foreground">Tema</Menu.Label>
          <ThemeMenuItems />
          <Menu.Separator className="my-1 h-px bg-border" />
          <Menu.Item
            onSelect={() => router.push("/account/security")}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-surface-muted"
          >
            <ShieldCheck className="size-4 text-muted-foreground" aria-hidden />
            Seguridad de la cuenta
          </Menu.Item>
          <Menu.Item
            onSelect={signOut}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-surface-muted"
          >
            <LogOut className="size-4 text-muted-foreground" aria-hidden />
            Cerrar sesión
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

export function Topbar({ orgName, isDemo, user, sections }: TopbarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-surface/85 px-4 backdrop-blur lg:px-6">
      <DialogPrimitive.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogPrimitive.Trigger asChild>
          <Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label="Abrir menú">
            <MenuIcon />
          </Button>
        </DialogPrimitive.Trigger>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 lg:hidden" />
          <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 w-72 overflow-y-auto border-r bg-sidebar lg:hidden">
            <DialogPrimitive.Title className="px-5 pt-4 text-sm font-semibold">
              {orgName}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">Menú de navegación</DialogPrimitive.Description>
            <SidebarNav sections={sections} onNavigate={() => setMobileOpen(false)} />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <CommandPalette sections={sections} />
      <div className="ml-auto flex items-center gap-3">
        {isDemo && (
          <Badge tone="warning" title="Organización con datos de demostración">
            {"DEMO"}
          </Badge>
        )}
        <UserMenu user={user} />
      </div>
    </header>
  );
}
