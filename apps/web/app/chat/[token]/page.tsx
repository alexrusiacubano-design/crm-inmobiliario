import { botPublicInfo } from "@crm/core";
import { getDb } from "@crm/db";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChatWidget } from "@/components/automations/chat-widget";

export const metadata: Metadata = { title: "Chat" };
export const dynamic = "force-dynamic";

export default async function PublicChatPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const info = await botPublicInfo(getDb(), token);
  if (!info) notFound();
  return <ChatWidget token={token} orgName={info.orgName} logoUrl={info.logoUrl} />;
}
