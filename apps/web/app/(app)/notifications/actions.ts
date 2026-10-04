"use server";

import { listNotifications, markNotificationsRead, unreadNotificationsCount } from "@crm/core";
import { runAction, type ActionResult } from "@/lib/actions";
import { relativeLabel } from "@/lib/utils";

export interface NotificationItem {
  id: string;
  title: string;
  body: string | null;
  href: string | null;
  read: boolean;
  when: string;
}

export async function notificationsSummaryAction(): Promise<
  ActionResult<{ count: number; items: NotificationItem[] }>
> {
  return runAction(async (db, ctx) => {
    const [count, rows] = await Promise.all([
      unreadNotificationsCount(db, ctx),
      listNotifications(db, ctx, { limit: 8 }),
    ]);
    const now = new Date();
    return {
      count,
      items: rows.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        href: n.href,
        read: n.readAt !== null,
        when: relativeLabel(n.createdAt, now),
      })),
    };
  });
}

export async function markNotificationsReadAction(ids?: string[]): Promise<ActionResult<undefined>> {
  return runAction(async (db, ctx) => void (await markNotificationsRead(db, ctx, ids)));
}
