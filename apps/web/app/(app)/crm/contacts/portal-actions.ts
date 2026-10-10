"use server";

import { revalidatePath } from "next/cache";
import { publicOrigin } from "@/lib/public-origin";
import { emailConfigured, inviteOwnerToPortal, revokePortalAccess, sendEmail } from "@crm/core";
import { runAction, type ActionResult } from "@/lib/actions";

export async function invitePortalAction(input: {
  contactId: string;
  email: string;
}): Promise<ActionResult<{ token: string; emailed: boolean }>> {
  const origin = await publicOrigin();
  const r = await runAction(async (db, ctx) => {
    const inv = await inviteOwnerToPortal(db, ctx, input);
    let emailed = false;
    if (emailConfigured()) {
      const link = `${origin}/portal/activar/${inv.token}`;
      // Si el envío falla, la invitación sigue válida y se puede mandar el enlace a mano.
      emailed = await sendEmail({
        to: input.email,
        subject: `${ctx.organization.name}: acceso al portal de propietarios`,
        text: `Hola ${inv.ownerName}:\n\nTe damos acceso al portal de propietarios de ${ctx.organization.name}, donde vas a ver tus propiedades, las visitas, ofertas, cuotas del inquilino y liquidaciones.\n\nPara activarlo, elegí tu contraseña acá (el enlace vence en 7 días):\n${link}\n\nSaludos.`,
      })
        .then(() => true)
        .catch(() => false);
    }
    return { token: inv.token, emailed };
  });
  if (r.ok) revalidatePath(`/crm/contacts/${input.contactId}`);
  return r;
}
export async function revokePortalAction(contactId: string): Promise<ActionResult<undefined>> {
  const r = await runAction(async (db, ctx) => void (await revokePortalAccess(db, ctx, contactId)));
  if (r.ok) revalidatePath(`/crm/contacts/${contactId}`);
  return r;
}
