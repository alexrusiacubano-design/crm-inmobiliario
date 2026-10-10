import { getStorage, readCatalogPhoto } from "@crm/core";
import { getDb } from "@crm/db";
import { getSite } from "@/lib/site";

/** Foto pública de una propiedad publicada en el sitio web propio. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const site = await getSite();
  if (!site) return new Response(null, { status: 404 });
  const size = new URL(request.url).searchParams.get("t") === "thumb" ? "thumb" : "full";
  const photo = await readCatalogPhoto(getDb(), getStorage(), site.id, id, size).catch(() => null);
  if (!photo) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(photo.body), {
    headers: {
      "Content-Type": photo.mimeType,
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
