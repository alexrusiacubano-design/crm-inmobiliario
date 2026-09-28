import { getStorage, readPropertyMedia } from "@crm/core";
import { runRoute } from "@/lib/route";

/** Sirve fotos y planos solo a usuarios que pueden ver la propiedad. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const size = new URL(request.url).searchParams.get("size") === "thumb" ? "thumb" : "full";
  return runRoute(request, async (db, ctx) => {
    const file = await readPropertyMedia(db, ctx, getStorage(), id, size);
    return new Response(new Uint8Array(file.body), {
      headers: {
        "Content-Type": file.mimeType,
        // Privado: nunca en caches compartidos. Las claves son inmutables (cada subida crea una nueva).
        "Cache-Control": "private, max-age=86400, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
