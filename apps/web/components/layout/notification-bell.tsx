"use client";

import * as Menu from "@radix-ui/react-dropdown-menu";
import { Bell, CheckCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  markNotificationsReadAction,
  notificationsSummaryAction,
  type NotificationItem,
} from "@/app/(app)/notifications/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Campanita: cantidad sin leer (se actualiza cada minuto) y las últimas notificaciones. */
export function NotificationBell({ initialCount }: { initialCount: number }) {
  const router = useRouter();
  const [count, setCount] = useState(initialCount);
  const [items, setItems] = useState<NotificationItem[] | null>(null);

  const refresh = useCallback(async () => {
    const r = await notificationsSummaryAction();
    if (r.ok) {
      setCount(r.data.count);
      setItems(r.data.items);
    }
  }, []);

  useEffect(() => {
    const id = setInterval(() => void refresh(), 60_000);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <Menu.Root onOpenChange={(open) => open && void refresh()}>
      <Menu.Trigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="relative"
          aria-label={count ? `Notificaciones: ${count} sin leer` : "Notificaciones"}
        >
          <Bell />
          {count > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white tabular">
              {count > 99 ? "99+" : count}
            </span>
          )}
        </Button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="end"
          sideOffset={8}
          className="z-50 w-80 max-w-[calc(100vw-2rem)] rounded-lg border bg-surface p-1 shadow-lg"
        >
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="text-sm font-semibold">Notificaciones</span>
            {count > 0 && (
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-primary hover:underline"
                onClick={async () => {
                  await markNotificationsReadAction();
                  await refresh();
                  router.refresh();
                }}
              >
                <CheckCheck className="size-3.5" /> Marcar todas como leídas
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items === null ? (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">Cargando…</p>
            ) : items.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">No tenés notificaciones.</p>
            ) : (
              items.map((n) => (
                <Menu.Item
                  key={n.id}
                  className={cn(
                    "flex cursor-pointer flex-col gap-0.5 rounded-md px-2 py-2 text-sm outline-none data-[highlighted]:bg-surface-muted",
                    !n.read && "bg-primary-soft/40",
                  )}
                  onSelect={async () => {
                    if (!n.read) await markNotificationsReadAction([n.id]);
                    if (n.href) router.push(n.href);
                    void refresh();
                  }}
                >
                  <span className={cn("leading-snug", !n.read && "font-medium")}>{n.title}</span>
                  {n.body && <span className="line-clamp-2 text-xs text-muted-foreground">{n.body}</span>}
                  <span className="text-[11px] text-muted-foreground">{n.when}</span>
                </Menu.Item>
              ))
            )}
          </div>
          <Menu.Separator className="my-1 h-px bg-border" />
          <Menu.Item asChild>
            <Link
              href="/notifications"
              className="block rounded-md px-2 py-1.5 text-center text-xs text-primary outline-none data-[highlighted]:bg-surface-muted"
            >
              Ver todas
            </Link>
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
