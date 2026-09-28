import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/misc";
import { requireSession } from "@/lib/session";
import { TwoFactorPanel } from "./two-factor";

export const metadata: Metadata = { title: "Seguridad de la cuenta" };

export default async function SecurityPage() {
  const { user } = await requireSession();
  return (
    <>
      <PageHeader title="Seguridad de la cuenta" description={user.email} />
      <TwoFactorPanel enabled={user.twoFactorEnabled} />
    </>
  );
}
