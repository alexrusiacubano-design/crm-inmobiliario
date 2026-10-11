import { getStorage, MAX_SITE_IMAGE_BYTES, uploadSiteHeroImage, ValidationError } from "@crm/core";
import { NextResponse } from "next/server";
import { readUpload, runRoute, tooLarge } from "@/lib/route";

/** Sube la imagen de portada del sitio al borrador (multipart, campo "file"). */
export async function POST(request: Request) {
  return runRoute(
    request,
    async (db, ctx) => {
      const big = tooLarge(request, MAX_SITE_IMAGE_BYTES + 64 * 1024);
      if (big) return big;
      const form = await request.formData().catch(() => {
        throw new ValidationError("Formulario inválido");
      });
      const file = await readUpload(form);
      const r = await uploadSiteHeroImage(db, ctx, getStorage(), file);
      return NextResponse.json(r, { status: 201 });
    },
    { mutates: true },
  );
}
