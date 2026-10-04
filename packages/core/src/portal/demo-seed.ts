import { and, eq, inArray } from "drizzle-orm";
import {
  contact,
  organization,
  ownerPortalAccess,
  property,
  propertyOwner,
  rentalContract,
  user,
  type Db,
} from "@crm/db";
import { insertCredentialUser } from "@crm/db/credentials";
import { DEMO_ORG_SLUG } from "@crm/db/seed";

export const DEMO_OWNER_EMAIL = "propietario@demo.example.com";

/**
 * Acceso DEMO al portal: el propietario de una propiedad alquilada (para que se vean cuotas y
 * liquidaciones) entra con propietario@demo.example.com y la contraseña DEMO.
 */
export async function seedDemoPortal(db: Db, password: string | undefined): Promise<{ skipped: boolean }> {
  if (!password) return { skipped: true };
  const [org] = await db.select().from(organization).where(eq(organization.slug, DEMO_ORG_SLUG));
  if (!org?.isDemo) throw new Error("No existe la organización DEMO");
  const [exists] = await db.select({ id: user.id }).from(user).where(eq(user.email, DEMO_OWNER_EMAIL));
  if (exists) return { skipped: true };
  const rented = await db
    .select({ propertyId: rentalContract.propertyId })
    .from(rentalContract)
    .where(and(eq(rentalContract.organizationId, org.id), eq(rentalContract.status, "active")));
  const ids = rented.map((r) => r.propertyId);
  const [owner] = await db
    .select({ contactId: propertyOwner.contactId, name: contact.displayName })
    .from(propertyOwner)
    .innerJoin(property, eq(property.id, propertyOwner.propertyId))
    .innerJoin(contact, eq(contact.id, propertyOwner.contactId))
    .where(
      ids.length
        ? and(eq(property.organizationId, org.id), inArray(property.id, ids))
        : eq(property.organizationId, org.id),
    )
    .limit(1);
  if (!owner) return { skipped: true };
  const [taken] = await db
    .select({ id: ownerPortalAccess.id })
    .from(ownerPortalAccess)
    .where(
      and(eq(ownerPortalAccess.organizationId, org.id), eq(ownerPortalAccess.contactId, owner.contactId)),
    );
  if (taken) return { skipped: true };
  const u = await insertCredentialUser(db, { name: owner.name, email: DEMO_OWNER_EMAIL, password });
  await db.insert(ownerPortalAccess).values({
    organizationId: org.id,
    contactId: owner.contactId,
    email: DEMO_OWNER_EMAIL,
    userId: u.id,
    status: "active",
    activatedAt: new Date(),
  });
  return { skipped: false };
}
