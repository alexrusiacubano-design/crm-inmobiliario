import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/session";

/** Las visitas viven en la agenda; esta entrada del menú abre la lista filtrada. */
export default async function VisitsPage() {
  await requirePagePermission("visit.read");
  redirect("/agenda?view=list&type=visit");
}
