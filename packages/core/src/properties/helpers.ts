import { and, asc, eq, inArray } from "drizzle-orm";
import {
  locality,
  neighborhood,
  property,
  propertyPrice,
  propertyPublication,
  searchDocument,
  type DbOrTx,
} from "@crm/db";
import {
  formatMoney,
  money,
  normalizeText,
  PROPERTY_OPERATION_LABELS,
  PROPERTY_STATUS_LABELS,
  PROPERTY_TYPE_LABELS,
  type PropertyOperation,
  type PropertyType,
} from "@crm/shared";
import type { ResourceRef } from "@crm/shared/rbac";

type PropertyRow = typeof property.$inferSelect;

export function propertyRef(
  p: Pick<PropertyRow, "organizationId" | "assignedUserId" | "branchId" | "teamId">,
): ResourceRef {
  return {
    organizationId: p.organizationId,
    ownerUserId: p.assignedUserId,
    branchId: p.branchId,
    teamId: p.teamId,
  };
}

export function propertyDisplayTitle(p: Pick<PropertyRow, "title" | "type" | "code">): string {
  return p.title?.trim() || `${PROPERTY_TYPE_LABELS[p.type as PropertyType]} ${p.code}`;
}

/** Índice de búsqueda global: código, título, dirección, barrio, localidad y tipo. */
export async function syncPropertySearch(tx: DbOrTx, propertyIds: readonly string[]): Promise<void> {
  if (propertyIds.length === 0) return;
  const rows = await tx
    .select({ p: property, localityName: locality.name, neighborhoodName: neighborhood.name })
    .from(property)
    .leftJoin(locality, eq(locality.id, property.localityId))
    .leftJoin(neighborhood, eq(neighborhood.id, property.neighborhoodId))
    .where(inArray(property.id, [...propertyIds]));
  const prices = await tx
    .select()
    .from(propertyPrice)
    .where(inArray(propertyPrice.propertyId, [...propertyIds]))
    .orderBy(asc(propertyPrice.operation));

  for (const { p, localityName, neighborhoodName } of rows) {
    if (p.deletedAt) {
      await tx
        .delete(searchDocument)
        .where(and(eq(searchDocument.entityType, "property"), eq(searchDocument.entityId, p.id)));
      continue;
    }
    const zone = [neighborhoodName, localityName].filter(Boolean).join(", ");
    const price = prices.find((pr) => pr.propertyId === p.id && pr.listMinor !== null);
    const subtitle = [
      PROPERTY_STATUS_LABELS[p.status],
      zone || null,
      price?.listMinor != null
        ? `${PROPERTY_OPERATION_LABELS[price.operation as PropertyOperation]} ${formatMoney(money(price.listMinor, price.currency))}`
        : null,
    ]
      .filter(Boolean)
      .join(" · ");
    const body = [
      p.code.toLowerCase(),
      p.code.toLowerCase().replace("-", ""),
      p.title ? normalizeText(p.title) : "",
      p.address ? normalizeText(p.address) : "",
      zone ? normalizeText(zone) : "",
      normalizeText(PROPERTY_TYPE_LABELS[p.type as PropertyType]),
    ]
      .filter(Boolean)
      .join(" ");
    const values = {
      entityType: "property",
      entityId: p.id,
      organizationId: p.organizationId,
      title: `${p.code} · ${propertyDisplayTitle(p)}`,
      subtitle,
      body,
      ownerUserId: p.assignedUserId,
      branchId: p.branchId,
      teamId: p.teamId,
    };
    await tx
      .insert(searchDocument)
      .values(values)
      .onConflictDoUpdate({
        target: [searchDocument.entityType, searchDocument.entityId],
        set: { ...values, updatedAt: new Date() },
      });
  }
}

/**
 * Cuando la propiedad deja de ofrecerse sus avisos se bajan (vendida, alquilada, retirada) o se
 * pausan (reservada, pausada) para no seguir recibiendo consultas.
 */
export async function syncPublicationsWithStatus(tx: DbOrTx, propertyId: string, status: string) {
  const retire = ["sold", "rented", "withdrawn"].includes(status);
  const pause = ["reserved", "paused", "draft"].includes(status);
  if (!retire && !pause) return;
  await tx
    .update(propertyPublication)
    .set({ status: retire ? "removed" : "paused", statusChangedAt: new Date() })
    .where(
      and(
        eq(propertyPublication.propertyId, propertyId),
        inArray(propertyPublication.status, retire ? ["published", "paused", "expired"] : ["published"]),
      ),
    );
}
