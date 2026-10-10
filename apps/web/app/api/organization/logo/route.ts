import { getStorage, MAX_LOGO_BYTES, removeOrganizationLogo, setOrganizationLogo, ValidationError } from "@crm/core";
import { NextResponse } from "next/server";
import { readUpload, runRoute, tooLarge } from "@/lib/route";

/** Sube o reemplaza el logo (multipart, campo "file"). */
export async function POST(request: Request) {
  return runRoute(
    request,
    async (db, ctx) => {
      const big = tooLarge(request, MAX_LOGO_BYTES + 64 * 1024);
      if (big) return big;
      const form = await request.formData().catch(() => {
        throw new ValidationError("Formulario inválido");
      });
      const file = await readUpload(form);
      const r = await setOrganizationLogo(db, ctx, getStorage(), file);
      return NextResponse.json(r, { status: 201 });
    },
    { mutates: true },
  );
}

export async function DELETE(request: Request) {
  return runRoute(
    request,
    async (db, ctx) => {
      await removeOrganizationLogo(db, ctx, getStorage());
      return NextResponse.json({ ok: true });
    },
    { mutates: true },
  );
}
