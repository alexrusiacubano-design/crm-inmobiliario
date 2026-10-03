import { and, count, eq, inArray } from "drizzle-orm";
import { organization, property, propertyPublication, type Db } from "@crm/db";
import { DEMO_ORG_SLUG } from "@crm/db/seed";
import { ConflictError } from "../errors";
import { ctxForDemo } from "./demo-seed";
import { listPortalAccounts, publishProperty, saveExchangeRate, savePortalAccount } from "./publications";

/** Avisos DEMO (sitio web e InfoCasas) y una cotización de referencia. Idempotente. */
export async function seedDemoPublications(db: Db): Promise<{ skipped: boolean; publications: number }> {
  const [org] = await db.select().from(organization).where(eq(organization.slug, DEMO_ORG_SLUG));
  if (!org?.isDemo) throw new Error("No existe la organización DEMO");
  const [existing] = await db
    .select({ n: count() })
    .from(propertyPublication)
    .where(eq(propertyPublication.organizationId, org.id));
  if ((existing?.n ?? 0) > 0) return { skipped: true, publications: 0 };

  const admin = await ctxForDemo(db, org.id, "admin");
  await listPortalAccounts(db, admin);
  await savePortalAccount(db, admin, {
    portal: "infocasas",
    enabled: true,
    accountRef: "DEMO-1234",
    quotas: { basic: 30, silver: 5, gold: 2, premium: 1 },
  });
  await saveExchangeRate(db, admin, { date: "2026-09-30", rate: "40,12" });

  const candidates = await db
    .select({ id: property.id })
    .from(property)
    .where(
      and(
        eq(property.organizationId, org.id),
        inArray(property.status, ["available", "published", "negotiating"]),
      ),
    )
    .limit(8);
  let n = 0;
  for (const [i, c] of candidates.entries()) {
    for (const portal of i < 4 ? (["website", "infocasas"] as const) : (["website"] as const)) {
      try {
        await publishProperty(db, admin, {
          propertyId: c.id,
          portal,
          level: portal === "infocasas" && i === 0 ? "gold" : "basic",
          url: portal === "infocasas" ? `https://www.infocasas.com.uy/demo-${i + 1}` : null,
          expiresAt: portal === "infocasas" ? (i === 1 ? "2026-10-06" : "2026-11-30") : null,
        });
        n++;
      } catch (e) {
        if (!(e instanceof ConflictError)) throw e; // checklist incompleto: se saltea
      }
    }
  }
  return { skipped: false, publications: n };
}
