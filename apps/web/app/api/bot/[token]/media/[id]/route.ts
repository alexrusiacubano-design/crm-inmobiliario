import { getStorage, readBotMedia } from "@crm/core";
import { getDb } from "@crm/db";

/** Fotos de las propiedades que muestra el asistente (solo las publicadas en el sitio web). */
export async function GET(request: Request, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const size = new URL(request.url).searchParams.get("size") === "full" ? "full" : "thumb";
  const file = await readBotMedia(getDb(), getStorage(), token, id, size);
  if (!file) return new Response("No encontrado", { status: 404 });
  return new Response(new Uint8Array(file.body), {
    headers: {
      "Content-Type": file.mimeType,
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
