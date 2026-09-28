import { and, eq, isNull } from "drizzle-orm";
import { contact, ownerProfile, type Db } from "@crm/db";
import { mask } from "@crm/shared";
import type { ResourceRef } from "@crm/shared/rbac";
import { ownerProfileSchema } from "@crm/shared/validation/crm";
import { uuidSchema } from "@crm/shared/validation";
import { writeAudit } from "../audit";
import { hasPermission, requirePermission, type RequestContext } from "../context";
import { decryptField, encryptField } from "../crypto";
import { NotFoundError, parseInput } from "../errors";
import { emitEvent } from "../events";
import { contactRef, logActivity } from "./helpers";

type OwnerRow = typeof ownerProfile.$inferSelect;

/**
 * Vista del perfil de propietario según permisos. Sin `owner.financial.read` no se ve ningún
 * dato bancario; con él se ve el número enmascarado (el completo requiere `revealAccountNumber`,
 * que queda auditado).
 */
export function maskedOwnerProfile(ctx: RequestContext, ref: ResourceRef, row: OwnerRow) {
  const financial = hasPermission(ctx, "owner.financial.read", ref);
  return {
    authorizationNotes: row.authorizationNotes,
    updatedAt: row.updatedAt,
    hasBankAccount: !!row.accountNumberEncrypted,
    bank: financial
      ? {
          bankName: row.bankName,
          accountHolder: row.accountHolder,
          accountCurrency: row.accountCurrency,
          accountNumberMasked: row.accountNumberLast4 ? mask(`00000000${row.accountNumberLast4}`) : null,
        }
      : null,
  };
}

async function loadContact(
  db: Db | Parameters<Parameters<Db["transaction"]>[0]>[0],
  ctx: RequestContext,
  id: string,
) {
  const [c] = await db
    .select()
    .from(contact)
    .where(
      and(eq(contact.id, id), eq(contact.organizationId, ctx.organizationId), isNull(contact.deletedAt)),
    );
  if (!c) throw new NotFoundError("Contacto");
  return c;
}

export async function upsertOwnerProfile(db: Db, ctx: RequestContext, rawInput: unknown) {
  const input = parseInput(ownerProfileSchema, rawInput);
  return db.transaction(async (tx) => {
    const c = await loadContact(tx, ctx, input.contactId);
    const ref = contactRef(c);
    requirePermission(ctx, "owner.update", ref);

    const [before] = await tx.select().from(ownerProfile).where(eq(ownerProfile.contactId, c.id));
    // Solo cuentan los campos bancarios enviados; ausentes = sin cambios.
    const changed = <T>(next: T | undefined, prev: T | null | undefined) =>
      next !== undefined && next !== (prev ?? null);
    const touchesBank =
      !!input.accountNumber ||
      changed(input.bankName, before?.bankName) ||
      changed(input.accountHolder, before?.accountHolder) ||
      changed(input.accountCurrency, before?.accountCurrency);
    if (touchesBank) requirePermission(ctx, "owner.financial.update", ref);

    const bankValues = touchesBank
      ? {
          ...(input.bankName !== undefined ? { bankName: input.bankName } : {}),
          ...(input.accountHolder !== undefined ? { accountHolder: input.accountHolder } : {}),
          ...(input.accountCurrency !== undefined ? { accountCurrency: input.accountCurrency } : {}),
          ...(input.accountNumber
            ? {
                accountNumberEncrypted: encryptField(input.accountNumber.replace(/\s/g, "")),
                accountNumberLast4: input.accountNumber.replace(/\s/g, "").slice(-4),
              }
            : {}),
        }
      : {};

    const values = { authorizationNotes: input.authorizationNotes, ...bankValues };
    const [after] = before
      ? await tx.update(ownerProfile).set(values).where(eq(ownerProfile.contactId, c.id)).returning()
      : await tx
          .insert(ownerProfile)
          .values({ contactId: c.id, organizationId: ctx.organizationId, ...values })
          .returning();

    const safe = (row: OwnerRow | undefined) =>
      row && { ...row, accountNumberEncrypted: row.accountNumberEncrypted ? "[cifrado]" : null };
    await writeAudit(tx, ctx, {
      action: touchesBank ? "owner.financial_update" : before ? "owner.update" : "owner.create",
      entityType: "contact",
      entityId: c.id,
      before: safe(before),
      after: safe(after),
    });
    await logActivity(tx, ctx, {
      type: "owner_updated",
      contactId: c.id,
      body: before ? "Se actualizaron los datos de propietario" : "Se registró como propietario",
    });
    await emitEvent(tx, ctx, {
      type: before ? "owner.updated" : "owner.created",
      aggregateType: "contact",
      aggregateId: c.id,
    });
    return { contactId: c.id };
  });
}

/** Muestra el número de cuenta completo. Cada consulta queda en la auditoría. */
export async function revealAccountNumber(
  db: Db,
  ctx: RequestContext,
  contactId: string,
): Promise<string | null> {
  const id = parseInput(uuidSchema, contactId);
  return db.transaction(async (tx) => {
    const c = await loadContact(tx, ctx, id);
    requirePermission(ctx, "owner.financial.read", contactRef(c));
    const [row] = await tx.select().from(ownerProfile).where(eq(ownerProfile.contactId, id));
    if (!row?.accountNumberEncrypted) return null;
    await writeAudit(tx, ctx, { action: "owner.financial_view", entityType: "contact", entityId: id });
    return decryptField(row.accountNumberEncrypted);
  });
}
