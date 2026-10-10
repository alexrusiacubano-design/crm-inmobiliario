import { hasPermission, unreadNotificationsCount } from "@crm/core";
import { getDb } from "@crm/db";
import type { Metadata } from "next";
import type { VisibleNavSection } from "@/components/layout/nav-types";
import { SidebarNav } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { scheduleAutomations } from "@/lib/automations";
import { t } from "@/lib/i18n";
import { NAVIGATION } from "@/lib/navigation";
import { getSessionContext, requireSession } from "@/lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const s = await getSessionContext();
  const logo = s?.ctx.organization.logoUrl;
  return logo ? { icons: { icon: logo, apple: logo } } : {};
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { ctx, user } = await requireSession();
  const unread = await unreadNotificationsCount(getDb(), ctx);
  scheduleAutomations(ctx.organizationId);

  // El menú se filtra en el servidor: el cliente solo recibe lo que puede ver.
  const sections: VisibleNavSection[] = NAVIGATION.flatMap((section) => {
    if (section.href) {
      if (!section.permission || !hasPermission(ctx, section.permission)) return [];
      return [
        {
          key: section.key,
          label: t(section.label),
          icon: section.icon,
          href: section.href,
          plannedPhase: section.plannedPhase,
          items: [],
        },
      ];
    }
    const items = (section.items ?? [])
      .filter((i) => hasPermission(ctx, i.permission))
      .map((i) => ({ href: i.href, label: t(i.label), plannedPhase: i.plannedPhase }));
    return items.length ? [{ key: section.key, label: t(section.label), icon: section.icon, items }] : [];
  });

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r bg-sidebar lg:flex">
        <div className="flex h-14 items-center gap-2.5 border-b px-5">
          {ctx.organization.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={ctx.organization.logoUrl}
              alt=""
              className="size-9 shrink-0 rounded-md bg-neutral-950 object-contain p-0.5"
            />
          ) : (
            <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
                <path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z" />
              </svg>
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight">{ctx.organization.name}</p>
            <p className="text-[11px] leading-tight text-muted-foreground">{t("app.name")}</p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          <SidebarNav sections={sections} />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          orgName={ctx.organization.name}
          isDemo={ctx.organization.isDemo}
          user={{ name: user.name, email: user.email }}
          sections={sections}
          unreadNotifications={unread}
        />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
