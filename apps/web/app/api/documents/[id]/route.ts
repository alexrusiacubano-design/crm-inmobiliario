import { getStorage, readDocumentFile } from "@crm/core";
import { contentDisposition, runRoute } from "@/lib/route";

const EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Descarga (o vista en línea) de un documento. Cada acceso queda en la auditoría. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const inline = new URL(request.url).searchParams.get("inline") === "1";
  return runRoute(request, async (db, ctx) => {
    const file = await readDocumentFile(db, ctx, getStorage(), { id });
    const name = `${file.name}.${EXT[file.mimeType] ?? "bin"}`;
    return new Response(new Uint8Array(file.body), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": contentDisposition(inline ? "inline" : "attachment", name),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        // Un PDF abierto en línea no puede ejecutar nada contra el origen del CRM.
        "Content-Security-Policy": "sandbox",
      },
    });
  });
}
