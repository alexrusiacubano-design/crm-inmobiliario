import { listNotifications } from "@crm/core";
import { getDb } from "@crm/db";
import { Bell } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { MarkAllReadButton } from "@/components/automations/mark-read-button";
import { Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { requireSession } from "@/lib/session";
import { cn, relativeLabel } from "@/lib/utils";

export const metadata: Metadata = { title: "Notificaciones" };

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { ctx } = await requireSession();
  const { filter } = await searchParams;
  const unreadOnly = filter === "unread";
  const rows = await listNotifications(getDb(), ctx, { unreadOnly, limit: 200 });
  const now = new Date();
  const chip = (active: boolean) =>
    cn(
      "rounded-full border px-3 py-1 text-xs",
      active ? "border-primary bg-primary-soft text-primary" : "text-muted-foreground hover:text-foreground",
    );
  return (
    <>
      <PageHeader
        title="Notificaciones"
        description="Avisos de las automatizaciones: leads nuevos, cuotas vencidas, contratos por vencer…"
        actions={<MarkAllReadButton />}
      />
      <div className="mb-3 flex gap-2">
        <Link href="?" className={chip(!unreadOnly)}>
          Todas
        </Link>
        <Link href="?filter=unread" className={chip(unreadOnly)}>
          Sin leer
        </Link>
      </div>
      <Card>
        {rows.length === 0 ? (
          <EmptyState
            icon={Bell}
            title={unreadOnly ? "Nada sin leer" : "Sin notificaciones"}
            description="Las automatizaciones que configure la administración te avisan acá."
          />
        ) : (
          <ul className="divide-y">
            {rows.map((n) => (
              <li key={n.id} className={cn("px-4 py-3", !n.readAt && "bg-primary-soft/30")}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  {n.href ? (
                    <Link href={n.href} className={cn("text-sm hover:underline", !n.readAt && "font-medium")}>
                      {n.title}
                    </Link>
                  ) : (
                    <span className={cn("text-sm", !n.readAt && "font-medium")}>{n.title}</span>
                  )}
                  <span className="text-xs text-muted-foreground">{relativeLabel(n.createdAt, now)}</span>
                </div>
                {n.body && <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
