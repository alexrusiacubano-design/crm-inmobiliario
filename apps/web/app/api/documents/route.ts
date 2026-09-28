import { getStorage, uploadDocument, ValidationError } from "@crm/core";
import { MAX_DOCUMENT_BYTES } from "@crm/shared";
import { NextResponse } from "next/server";
import { readUpload, runRoute, tooLarge } from "@/lib/route";

/** Subida de documentos al expediente de una propiedad o contacto. */
export async function POST(request: Request) {
  return runRoute(
    request,
    async (db, ctx) => {
      const big = tooLarge(request, MAX_DOCUMENT_BYTES + 64 * 1024);
      if (big) return big;
      const form = await request.formData().catch(() => {
        throw new ValidationError("Formulario inválido");
      });
      const file = await readUpload(form);
      const text = (k: string) => {
        const v = form.get(k);
        return typeof v === "string" ? v : undefined;
      };
      const row = await uploadDocument(
        db,
        ctx,
        getStorage(),
        {
          entityType: text("entityType"),
          entityId: text("entityId"),
          category: text("category"),
          type: text("type"),
          name: text("name") || file.fileName.replace(/\.[a-z0-9]+$/i, ""),
          expiresAt: text("expiresAt") || null,
          visibility: text("visibility") || undefined,
          status: text("status") || undefined,
        },
        file,
      );
      return NextResponse.json({ id: row.id }, { status: 201 });
    },
    { mutates: true },
  );
}
