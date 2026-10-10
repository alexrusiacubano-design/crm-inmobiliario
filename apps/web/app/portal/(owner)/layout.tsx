import type { Metadata } from "next";
import Link from "next/link";
import { requirePortalSession } from "@/lib/session";
import { PortalSignOut } from "../portal-client";

export const metadata: Metadata = { title: { default: "Portal del propietario", template: "%s · Portal" } };

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const { pctx } = await requirePortalSession();
  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-30 border-b bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4">
          <Link href="/portal" className="flex min-w-0 items-center gap-2.5">
            {pctx.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={pctx.logoUrl} alt="" className="size-9 shrink-0 rounded-md bg-neutral-950 object-contain p-0.5" />
          ) : null}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{pctx.orgName}</p>
              <p className="text-[11px] text-muted-foreground">Portal del propietario</p>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-muted-foreground sm:inline">{pctx.ownerName}</span>
            <PortalSignOut />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
