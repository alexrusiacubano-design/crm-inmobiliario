import { eq } from "drizzle-orm";
import {
  branch,
  membership,
  membershipRole,
  organization,
  team,
  teamMember,
  type Db,
  type DbHandle,
} from "@crm/db";
import { insertCredentialUser } from "@crm/db/credentials";
import { ensureSystemRoles } from "@crm/db/seed";
import { prepareTestDatabase } from "@crm/db/testing";
import { loadContext, type RequestContext } from "../src/context";

export const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? "postgresql://crm:crm@localhost:5432/crm_test";

export async function freshDb(): Promise<DbHandle> {
  return prepareTestDatabase(TEST_DB_URL);
}

export interface TestOrg {
  organizationId: string;
  roleIds: Map<string, string>;
  branchIds: { main: string; second: string };
  teamId: string;
  members: Record<string, { userId: string; membershipId: string }>;
}

let counter = 0;

/**
 * Crea una organización mínima con dos sucursales, un equipo y un usuario por cada rol
 * indicado. Cada llamada usa emails únicos para poder crear varias organizaciones.
 */
export async function createTestOrg(
  db: Db,
  slug: string,
  users: Record<
    string,
    { roleKey: string; branch?: "main" | "second"; inTeam?: boolean; roleBranchOnly?: boolean }
  >,
): Promise<TestOrg> {
  counter += 1;
  const [org] = await db
    .insert(organization)
    .values({ name: `Org ${slug}`, slug })
    .returning();
  if (!org) throw new Error("org");
  const roleIds = await ensureSystemRoles(db, org.id);
  const [main] = await db
    .insert(branch)
    .values({ organizationId: org.id, name: "Central", code: "CEN" })
    .returning();
  const [second] = await db
    .insert(branch)
    .values({ organizationId: org.id, name: "Este", code: "EST" })
    .returning();
  if (!main || !second) throw new Error("branch");
  const [t] = await db
    .insert(team)
    .values({ organizationId: org.id, branchId: main.id, name: "Ventas" })
    .returning();
  if (!t) throw new Error("team");

  const members: TestOrg["members"] = {};
  for (const [key, spec] of Object.entries(users)) {
    const { id: userId } = await insertCredentialUser(db, {
      name: `${key} ${slug}`,
      email: `${key}.${slug}.${counter}@test.example.com`,
      password: "Password-123",
    });
    const branchId = spec.branch === "second" ? second.id : main.id;
    const [m] = await db
      .insert(membership)
      .values({ organizationId: org.id, userId, defaultBranchId: branchId })
      .returning();
    if (!m) throw new Error("membership");
    const roleId = roleIds.get(spec.roleKey);
    if (!roleId) throw new Error(`rol ${spec.roleKey}`);
    await db.insert(membershipRole).values({
      organizationId: org.id,
      membershipId: m.id,
      roleId,
      branchId: spec.roleBranchOnly ? branchId : null,
    });
    if (spec.inTeam)
      await db.insert(teamMember).values({ organizationId: org.id, teamId: t.id, membershipId: m.id });
    members[key] = { userId, membershipId: m.id };
  }
  return {
    organizationId: org.id,
    roleIds,
    branchIds: { main: main.id, second: second.id },
    teamId: t.id,
    members,
  };
}

export async function ctxFor(db: Db, org: TestOrg, key: string): Promise<RequestContext> {
  const m = org.members[key];
  if (!m) throw new Error(`miembro ${key}`);
  return loadContext(db, {
    userId: m.userId,
    organizationId: org.organizationId,
    meta: { requestId: "test" },
  });
}

export async function setStatus(db: Db, membershipId: string, status: "active" | "suspended") {
  await db.update(membership).set({ status }).where(eq(membership.id, membershipId));
}
