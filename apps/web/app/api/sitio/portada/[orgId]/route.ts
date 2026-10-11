import { getStorage, readSiteHeroImage } from "@crm/core";
import { getDb } from "@crm/db";

/** Imagen de portada del sitio público (solo la del borrador o la publicada de esa inmobiliaria). */
export async function GET(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const key = new URL(request.url).searchParams.get("k") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(orgId) || !key) return new Response(null, { status: 404 });
  const img = await readSiteHeroImage(getDb(), getStorage(), orgId, key).catch(() => null);
  if (!img) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(img), {
    headers: {
      "Content-Type": "image/webp",
      // La clave cambia con cada imagen subida: se puede cachear mucho tiempo.
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
