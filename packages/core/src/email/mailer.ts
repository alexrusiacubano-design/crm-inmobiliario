import { and, desc, eq } from "drizzle-orm";
import { contact, contactChannel, user, type Db, type DbOrTx } from "@crm/db";
import { z } from "zod";
import { uuidSchema } from "@crm/shared/validation";
import { composeContext } from "../communications/templates";
import { logInteraction } from "../crm/timeline";
import { requirePermission, type RequestContext } from "../context";
import { ConflictError, NotFoundError, parseInput } from "../errors";

/**
 * Envío de email con Resend (API HTTP, funciona en Vercel). Se activa con RESEND_API_KEY y
 * EMAIL_FROM ("Inmobiliaria <avisos@tu-dominio.com.uy>", dominio verificado en Resend). Sin
 * esas variables el CRM sigue abriendo el correo del usuario (mailto).
 */
export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  replyTo?: string | null;
}

/** Texto plano → HTML simple (escapado, con saltos de línea y enlaces). */
export function textToHtml(text: string): string {
  const esc = text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
  const linked = esc.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#1f2933">${linked
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("")}</div>`;
}

export async function sendEmail(mail: OutgoingEmail): Promise<{ id: string }> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from)
    throw new ConflictError("El envío de emails no está configurado (RESEND_API_KEY y EMAIL_FROM)");
  if (!z.email().safeParse(mail.to).success) throw new ConflictError(`Email de destino inválido: ${mail.to}`);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [mail.to],
      subject: mail.subject.slice(0, 250),
      text: mail.text,
      html: textToHtml(mail.text),
      ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!res.ok || !data.id)
    throw new ConflictError(`No se pudo enviar el email: ${data.message ?? `HTTP ${res.status}`}`);
  return { id: data.id };
}

/** Email principal de un contacto de la organización. */
export async function primaryEmail(
  db: DbOrTx,
  organizationId: string,
  contactId: string,
): Promise<string | null> {
  const [r] = await db
    .select({ v: contactChannel.value })
    .from(contactChannel)
    .innerJoin(contact, eq(contact.id, contactChannel.contactId))
    .where(
      and(
        eq(contactChannel.contactId, contactId),
        eq(contact.organizationId, organizationId),
        eq(contactChannel.type, "email"),
      ),
    )
    .orderBy(desc(contactChannel.isPrimary))
    .limit(1);
  return r?.v ?? null;
}

const sendToContactSchema = z.object({
  contactId: uuidSchema,
  leadId: uuidSchema.optional().nullable(),
  subject: z.string().trim().min(2, "Escribí el asunto").max(200),
  body: z.string().trim().min(2, "Escribí el mensaje").max(10_000),
});

/** Envía un email a un contacto desde el CRM y lo deja en su timeline. */
export async function sendEmailToContact(db: Db, ctx: RequestContext, rawInput: unknown) {
  requirePermission(ctx, "communication.send");
  const input = parseInput(sendToContactSchema, rawInput);
  // composeContext valida que quien envía pueda ver al contacto.
  const c = await composeContext(db, ctx, { contactId: input.contactId });
  const to = c.email;
  if (!to) throw new NotFoundError("Email del contacto");
  const [me] = await db.select({ email: user.email }).from(user).where(eq(user.id, ctx.userId));
  const sent = await sendEmail({ to, subject: input.subject, text: input.body, replyTo: me?.email ?? null });
  await logInteraction(db, ctx, {
    contactId: input.contactId,
    leadId: input.leadId ?? null,
    type: "email",
    direction: "outbound",
    body: `${input.subject}\n\n${input.body}`,
  });
  return { ...sent, to };
}
