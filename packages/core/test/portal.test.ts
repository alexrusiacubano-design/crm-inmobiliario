import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { locality, neighborhood, notification, ownerPortalAccess, type DbHandle } from "@crm/db";
import { seedGeoUruguay } from "@crm/db/seed";
import {
  activatePortalAccess,
  ConflictError,
  createContact,
  createProperty,
  ForbiddenError,
  inviteOwnerToPortal,
  loadPortalContext,
  NotFoundError,
  portalInviteInfo,
  portalOverview,
  portalProperty,
  revokePortalAccess,
  sendOwnerMessage,
  setPropertyOwners,
  setPrices,
  ValidationError,
} from "../src";
import { createTestOrg, ctxFor, freshDb, type TestOrg } from "./fixtures";

let h: DbHandle;
let org: TestOrg;
const today = new Date().toISOString().slice(0, 10);

async function catchErr(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => null,
    (e: unknown) => e,
  );
}

beforeAll(async () => {
  h = await freshDb();
  await seedGeoUruguay(h.db);
  org = await createTestOrg(h.db, "portal", {
    admin: { roleKey: "admin" },
    agenteA: { roleKey: "agent", inTeam: true },
    agenteB: { roleKey: "agent", branch: "second" },
  });
});
afterAll(async () => {
  await h.pool.end();
});

async function ownerWithProperty(name: string) {
  const a = await ctxFor(h.db, org, "agenteA");
  const [n] = await h.db
    .select({ localityId: locality.id, neighborhoodId: neighborhood.id })
    .from(neighborhood)
    .innerJoin(locality, eq(locality.id, neighborhood.localityId))
    .limit(1);
  const p = await createProperty(h.db, a, {
    type: "apartment",
    operations: ["rent"],
    title: `Apartamento de ${name}`,
    localityId: n?.localityId,
    neighborhoodId: n?.neighborhoodId,
  });
  await setPrices(h.db, a, {
    propertyId: p.id,
    prices: [{ operation: "rent", currency: "UYU", list: "30000" }],
  });
  const owner = (await createContact(h.db, a, { firstName: name, lastName: "Dueño" })).contact;
  await setPropertyOwners(h.db, a, {
    propertyId: p.id,
    owners: [{ contactId: owner.id, sharePercent: "100" }],
  });
  return { p, owner };
}

describe("portal del propietario", () => {
  it("invitación, activación, datos propios y revocación", async () => {
    const admin = await ctxFor(h.db, org, "admin");
    const { p, owner } = await ownerWithProperty("Ana");
    const other = await ownerWithProperty("Beto");
    const plain = (await createContact(h.db, admin, { firstName: "Sin", lastName: "Propiedades" })).contact;

    expect(
      await catchErr(inviteOwnerToPortal(h.db, admin, { contactId: plain.id, email: "x@example.com" })),
    ).toBeInstanceOf(ConflictError);
    const adminEmail = (await h.db.execute(sql`select email from "user" limit 1`)).rows[0]?.email as string;
    expect(
      await catchErr(inviteOwnerToPortal(h.db, admin, { contactId: owner.id, email: adminEmail })),
    ).toBeInstanceOf(ValidationError);

    const inv = await inviteOwnerToPortal(h.db, admin, {
      contactId: owner.id,
      email: "Ana.Duena@Example.com",
    });
    expect(inv.token).toMatch(/^[0-9a-f]{64}$/);
    expect(await portalInviteInfo(h.db, inv.token)).toMatchObject({ email: "ana.duena@example.com" });
    // El token no se guarda en claro.
    const [row] = await h.db
      .select()
      .from(ownerPortalAccess)
      .where(eq(ownerPortalAccess.contactId, owner.id));
    expect(row?.inviteTokenHash).not.toBe(inv.token);

    expect(
      await catchErr(activatePortalAccess(h.db, { token: inv.token, password: "corta", confirm: "corta" })),
    ).toBeInstanceOf(ValidationError);
    await activatePortalAccess(h.db, {
      token: inv.token,
      password: "clave-segura-123",
      confirm: "clave-segura-123",
    });
    expect(
      await catchErr(
        activatePortalAccess(h.db, {
          token: inv.token,
          password: "clave-segura-123",
          confirm: "clave-segura-123",
        }),
      ),
    ).toBeInstanceOf(ConflictError); // un solo uso

    const [active] = await h.db
      .select()
      .from(ownerPortalAccess)
      .where(eq(ownerPortalAccess.contactId, owner.id));
    const loaded = await loadPortalContext(h.db, active?.userId ?? "");
    expect(loaded?.contactId).toBe(owner.id);
    if (!loaded) throw new Error("sin contexto de portal");
    const pctx = loaded;
    const ov = await portalOverview(h.db, pctx);
    expect(ov.properties.map((x) => x.id)).toEqual([p.id]);
    expect(ov.properties[0]?.prices[0]).toMatchObject({ currency: "UYU", listMinor: "3000000" });
    const detail = await portalProperty(h.db, pctx, p.id, today);
    expect(detail.contract).toBeNull();
    expect(await catchErr(portalProperty(h.db, pctx, other.p.id, today))).toBeInstanceOf(NotFoundError);

    const r = await sendOwnerMessage(h.db, pctx, {
      propertyId: p.id,
      message: "¿Hubo visitas esta semana?",
    });
    expect(r.delivered).toBe(true);
    const [n] = await h.db
      .select()
      .from(notification)
      .where(eq(notification.userId, org.members.agenteA?.userId ?? ""));
    expect(n?.title).toContain("Ana Dueño");
    expect(
      await catchErr(sendOwnerMessage(h.db, pctx, { propertyId: other.p.id, message: "hola!" })),
    ).toBeInstanceOf(NotFoundError);

    // Un agente solo gestiona el portal de sus propietarios.
    const agent = await ctxFor(h.db, org, "agenteB");
    expect(await catchErr(revokePortalAccess(h.db, agent, owner.id))).toBeInstanceOf(ForbiddenError);
    await revokePortalAccess(h.db, admin, owner.id);
    expect(await loadPortalContext(h.db, active?.userId ?? "")).toBeNull();
  });

  it("todas las tablas públicas tienen RLS activado", async () => {
    const r = await h.db.execute(
      sql`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(r.rows).toEqual([]);
  });
});
