import { chatPeople, listInquiries } from "@crm/core";
import { getDb } from "@crm/db";
import type { Metadata } from "next";
import Link from "next/link";
import { InquiryList, NewInquiryButton } from "@/components/communications/inbox";
import { Card, PageHeader } from "@/components/ui/misc";
import { requirePagePermission } from "@/lib/session";
import { cn, formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Consultas" };

const TABS = [
  { key: "open", label: "Abiertas" },
  { key: "mine", label: "Mías" },
  { key: "taken", label: "Tomadas" },
  { key: "resolved", label: "Resueltas" },
  { key: "rejected", label: "Descartadas" },
  { key: "all", label: "Todas" },
] as const;

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { ctx } = await requirePagePermission("communication.read");
  const params = await searchParams;
  const status = TABS.some((t) => t.key === params.status)
    ? (params.status as (typeof TABS)[number]["key"])
    : "open";
  const db = getDb();
  const r = await listInquiries(db, ctx, { status });
  const people = r.permissions.assign
    ? [{ userId: ctx.userId, name: "Yo" }, ...(await chatPeople(db, ctx))]
    : [];
  const chip = (active: boolean) =>
    cn(
      "rounded-full border px-3 py-1 text-xs",
      active ? "border-primary bg-primary-soft text-primary" : "text-muted-foreground hover:text-foreground",
    );
  const count = (k: string) =>
    k === "all" ? null : ((r.counts as Record<string, number | undefined>)[k] ?? 0);

  return (
    <>
      <PageHeader
        title="Consultas"
        description="Lo que entra por el sitio, portales, WhatsApp o el asistente y todavía no tiene dueño. Tomala, derivala o convertila en lead."
        actions={r.permissions.act ? <NewInquiryButton /> : undefined}
      />
      <div className="mb-3 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link key={t.key} href={`?status=${t.key}`} className={chip(status === t.key)}>
            {t.label}
            {count(t.key) !== null && <span className="ml-1 tabular">{count(t.key)}</span>}
          </Link>
        ))}
      </div>
      <Card>
        <InquiryList
          items={r.items.map((i) => ({
            id: i.id,
            channel: i.channel,
            status: i.status,
            name: i.name,
            phone: i.phone,
            email: i.email,
            message: i.message,
            propertyId: i.propertyId,
            propertyLabel: i.propertyLabel,
            contactId: i.contactId,
            contactName: i.contactName,
            leadId: i.leadId,
            assignedUserId: i.assignedUserId,
            assignedName: i.assignedName,
            resolutionNote: i.resolutionNote,
            createdAtLabel: formatDateTime(i.createdAt),
            waitingMinutes: i.waitingMinutes,
            late: i.late,
          }))}
          canAct={r.permissions.act}
          canAssign={r.permissions.assign}
          canConvert={r.permissions.convert}
          people={people}
          meId={ctx.userId}
        />
      </Card>
      <p className="mt-3 text-xs text-muted-foreground">
        Para recibir consultas del sitio web: POST a <code>/api/inquiries?org=&lt;organización&gt;</code> con
        el header <code>x-crm-key</code> (variable INQUIRY_WEBHOOK_SECRET).
      </p>
    </>
  );
}
