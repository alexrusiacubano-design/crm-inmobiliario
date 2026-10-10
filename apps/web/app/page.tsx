import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/session";

/** Con sesión: al CRM. Sin sesión: al catálogo público de propiedades. */
export default async function Home() {
  const s = await getSessionContext().catch(() => null);
  redirect(s ? "/dashboard" : "/propiedades");
}
