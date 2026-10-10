import { getStorage, readOrganizationLogo } from "@crm/core";
import { getDb } from "@crm/db";

/**
 * Logo de la organización. Es público (se ve en el inicio de sesión, el chat del sitio web,
 * el portal del propietario y los documentos), por eso no pide sesión.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) return new Response(null, { status: 404 });
  const png = await readOrganizationLogo(getDb(), getStorage(), orgId).catch(() => null);
  if (!png) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
