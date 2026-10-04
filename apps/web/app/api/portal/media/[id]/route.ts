import { getStorage, readPortalMedia } from "@crm/core";
import { getDb } from "@crm/db";
import { getPortalSession } from "@/lib/session";

/** Fotos de las propiedades del propietario que tiene la sesión. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getPortalSession();
  if (!s) return new Response("No autorizado", { status: 401 });
  const { id } = await params;
  const size = new URL(request.url).searchParams.get("size") === "full" ? "full" : "thumb";
  const file = await readPortalMedia(getDb(), getStorage(), s.pctx, id, size);
  if (!file) return new Response("No encontrado", { status: 404 });
  return new Response(new Uint8Array(file.body), {
    headers: {
      "Content-Type": file.mimeType,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
