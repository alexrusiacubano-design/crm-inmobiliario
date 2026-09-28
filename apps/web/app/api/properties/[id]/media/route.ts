import { addPropertyImage, getStorage, ValidationError } from "@crm/core";
import { MAX_IMAGE_BYTES } from "@crm/shared";
import { NextResponse } from "next/server";
import { readUpload, runRoute, tooLarge } from "@/lib/route";

/** Subida de una foto o plano (multipart). El servicio valida tipo real, tamaño y permisos. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return runRoute(
    request,
    async (db, ctx) => {
      const big = tooLarge(request, MAX_IMAGE_BYTES + 64 * 1024);
      if (big) return big;
      const form = await request.formData().catch(() => {
        throw new ValidationError("Formulario inválido");
      });
      const file = await readUpload(form);
      const row = await addPropertyImage(
        db,
        ctx,
        getStorage(),
        { propertyId: id, kind: form.get("kind") ?? "photo" },
        file,
      );
      return NextResponse.json({ id: row.id, isCover: row.isCover }, { status: 201 });
    },
    { mutates: true },
  );
}
