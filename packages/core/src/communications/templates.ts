import { and, asc, eq, isNull } from "drizzle-orm";
import {
  contact,
  contactChannel,
  messageTemplate,
  property,
  propertyPrice,
  user,
  type Db,
  type DbOrTx,
} from "@crm/db";
import {
  DEFAULT_TEMPLATES,
  formatMoney,
  money,
  PROPERTY_OPERATION_LABELS,
  type TemplateChannel,
  type TemplateVariable,
} from "@crm/shared";
import { logOutboundSchema, templateSchema } from "@crm/shared/validation/communications";
import { uuidSchema } from "@crm/shared/validation";
import { writeAudit } from "../audit";
import { hasPermission, requirePermission, type RequestContext } from "../context";
import { contactRef } from "../crm/helpers";
import { logInteraction } from "../crm/timeline";
import { ConflictError, ForbiddenError, NotFoundError, parseInput } from "../errors";
import { propertyDisplayTitle } from "../properties/helpers";

/** Plantillas de la organización; si no hay ninguna se cargan las sugeridas. */
export async function listTemplates(
  db: Db,
  ctx: RequestContext,
  opts: { channel?: TemplateChannel; includeInactive?: boolean } = {},
) {
  if (!hasPermission(ctx, "communication.send") && !hasPermission(ctx, "template.manage"))
    throw new ForbiddenError();
  const [any] = await db
    .select({ id: messageTemplate.id })
    .from(messageTemplate)
    .where(eq(messageTemplate.organizationId, ctx.organizationId))
    .limit(1);
  if (!any)
    await db
      .insert(messageTemplate)
      .values(
        DEFAULT_TEMPLATES.map((t) => ({
          ...t,
          subject: t.subject ?? null,
          organizationId: ctx.organizationId,
        })),
      )
      .onConflictDoNothing();
  return db
    .select()
    .from(messageTemplate)
    .where(
      and(
        eq(messageTemplate.organizationId, ctx.organizationId),
        opts.channel ? eq(messageTemplate.channel, opts.channel) : undefined,
        opts.includeInactive ? undefined : eq(messageTemplate.active, true),
      ),
    )
    .orderBy(asc(messageTemplate.channel), asc(messageTemplate.name));
}

export async function saveTemplate(db: Db, ctx: RequestContext, rawInput: unknown) {
  requirePermission(ctx, "template.manage");
  const input = parseInput(templateSchema, rawInput);
  return db.transaction(async (tx) => {
    const values = {
      name: input.name,
      channel: input.channel,
      subject: input.channel === "email" ? input.subject : null,
      body: input.body,
      active: input.active,
    };
    if (input.id) {
      const [before] = await tx
        .select()
        .from(messageTemplate)
        .where(and(eq(messageTemplate.id, input.id), eq(messageTemplate.organizationId, ctx.organizationId)));
      if (!before) throw new NotFoundError("Plantilla");
      const [after] = await tx
        .update(messageTemplate)
        .set(values)
        .where(eq(messageTemplate.id, before.id))
        .returning()
        .catch((e: unknown) => {
          throw dupe(e);
        });
      await writeAudit(tx, ctx, {
        action: "template.update",
        entityType: "message_template",
        entityId: before.id,
        before,
        after,
      });
      return after;
    }
    const [row] = await tx
      .insert(messageTemplate)
      .values({ ...values, organizationId: ctx.organizationId, createdById: ctx.userId })
      .returning()
      .catch((e: unknown) => {
        throw dupe(e);
      });
    if (!row) throw new Error("No se pudo guardar");
    await writeAudit(tx, ctx, {
      action: "template.create",
      entityType: "message_template",
      entityId: row.id,
      after: row,
    });
    return row;
  });
}

function dupe(e: unknown) {
  return String((e as { cause?: { code?: string } })?.cause?.code ?? (e as { code?: string })?.code) ===
    "23505"
    ? new ConflictError("Ya existe una plantilla con ese nombre en el canal")
    : e;
}

/** Valores para completar las variables de una plantilla. */
export async function composeContext(
  db: DbOrTx,
  ctx: RequestContext,
  opts: { contactId: string; propertyId?: string | null },
) {
  requirePermission(ctx, "communication.send");
  const id = parseInput(uuidSchema, opts.contactId);
  const [c] = await db
    .select()
    .from(contact)
    .where(
      and(eq(contact.id, id), eq(contact.organizationId, ctx.organizationId), isNull(contact.deletedAt)),
    );
  if (!c) throw new NotFoundError("Contacto");
  const ref = contactRef(c);
  if (!hasPermission(ctx, "contact.read", ref) && !hasPermission(ctx, "lead.read", ref))
    throw new NotFoundError("Contacto");
  const [channels, [me]] = await Promise.all([
    db.select().from(contactChannel).where(eq(contactChannel.contactId, c.id)),
    db.select({ name: user.name }).from(user).where(eq(user.id, ctx.userId)),
  ]);
  const values: Partial<Record<TemplateVariable, string>> = {
    nombre: c.firstName ?? c.displayName.split(" ")[0] ?? "",
    apellido: c.lastName ?? "",
    agente: me?.name ?? "",
    inmobiliaria: ctx.organization.name,
  };
  if (opts.propertyId) {
    const [p] = await db
      .select()
      .from(property)
      .where(
        and(
          eq(property.id, parseInput(uuidSchema, opts.propertyId)),
          eq(property.organizationId, ctx.organizationId),
        ),
      );
    if (p) {
      const prices = await db.select().from(propertyPrice).where(eq(propertyPrice.propertyId, p.id));
      const pr = prices.find((x) => x.listMinor !== null);
      values.propiedad = propertyDisplayTitle(p);
      values.codigo = p.code;
      values.direccion = p.address ?? "";
      values.precio =
        pr?.listMinor != null
          ? `${formatMoney(money(pr.listMinor, pr.currency))}${p.operations.length > 1 ? ` (${PROPERTY_OPERATION_LABELS[pr.operation].toLowerCase()})` : ""}`
          : "";
    }
  }
  return {
    values,
    displayName: c.displayName,
    whatsapp:
      channels.find((ch) => ch.type === "whatsapp")?.normalized ??
      channels.find((ch) => ch.type === "phone")?.normalized ??
      null,
    email: channels.find((ch) => ch.type === "email")?.normalized ?? null,
  };
}

/** Deja en el timeline lo que se envió desde WhatsApp o el correo del usuario. */
export async function logOutbound(db: Db, ctx: RequestContext, rawInput: unknown) {
  requirePermission(ctx, "communication.send");
  const input = parseInput(logOutboundSchema, rawInput);
  return logInteraction(db, ctx, {
    contactId: input.contactId,
    leadId: input.leadId,
    type: input.channel,
    direction: "outbound",
    body: input.subject ? `${input.subject}\n\n${input.body}` : input.body,
  });
}
