import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { membership, type DbHandle } from "@crm/db";
import { PERMISSION_CODES, type PermissionCode } from "@crm/shared/rbac";
import { hasPermission, loadContext, scopeCondition, UnauthenticatedError } from "../src";
import { createTestOrg, ctxFor, freshDb, setStatus, type TestOrg } from "./fixtures";

let h: DbHandle;
let org: TestOrg;

const ROLES = {
  superadmin: { roleKey: "super_admin" },
  admin: { roleKey: "admin" },
  director: { roleKey: "director" },
  gerente: { roleKey: "manager", branch: "second" as const, roleBranchOnly: true },
  supervisor: { roleKey: "supervisor", inTeam: true },
  agente: { roleKey: "agent", inTeam: true },
  agenteLejano: { roleKey: "agent", branch: "second" as const },
  administracion: { roleKey: "rental_admin" },
  contabilidad: { roleKey: "accounting" },
  recepcion: { roleKey: "reception" },
};

beforeAll(async () => {
  h = await freshDb();
  org = await createTestOrg(h.db, "perm", ROLES);
});
afterAll(async () => {
  await h.pool.end();
});

/**
 * Matriz esperada de permisos de organización por rol. Si alguien cambia un rol de sistema
 * sin querer, este test lo detecta.
 */
const MATRIX: Record<keyof typeof ROLES, Partial<Record<PermissionCode, boolean>>> = {
  superadmin: {
    "users.manage": true,
    "roles.manage": true,
    "audit.read": true,
    "owner.financial.read": true,
  },
  admin: { "users.manage": true, "roles.manage": true, "audit.read": true, "settings.manage": true },
  director: {
    "users.manage": false,
    "roles.manage": false,
    "audit.read": true,
    "report.read": true,
    "deal.close": true,
  },
  gerente: { "users.manage": false, "audit.read": false, "report.read": true, "users.read": true },
  supervisor: { "users.manage": false, "lead.assign": true, "commission.manage": false },
  agente: {
    "users.manage": false,
    "users.read": false,
    "audit.read": false,
    "owner.financial.read": false,
    "commission.manage": false,
    "lead.create": true,
    "property.read": true,
  },
  agenteLejano: { "users.manage": false, "lead.create": true },
  administracion: {
    "contract.manage": true,
    "owner.financial.read": true,
    "commission.manage": false,
    "users.manage": false,
  },
  contabilidad: {
    "commission.manage": true,
    "invoice.manage": true,
    "payment.void": true,
    "lead.create": false,
  },
  recepcion: { "lead.create": true, "visit.manage": true, "property.update": false, "contact.update": false },
};

describe("permisos por rol sembrado", () => {
  for (const [key, expected] of Object.entries(MATRIX)) {
    it(`${key}`, async () => {
      const ctx = await ctxFor(h.db, org, key);
      for (const [code, allowed] of Object.entries(expected)) {
        expect(hasPermission(ctx, code as PermissionCode), `${key} → ${code}`).toBe(allowed);
      }
    });
  }

  it("Super Admin tiene todos los permisos del catálogo", async () => {
    const ctx = await ctxFor(h.db, org, "superadmin");
    for (const code of PERMISSION_CODES) expect(hasPermission(ctx, code), code).toBe(true);
  });
});

describe("alcance sobre registros concretos", () => {
  it("agente: solo sus leads; supervisor: los del equipo; gerente: solo su sucursal", async () => {
    const agente = await ctxFor(h.db, org, "agente");
    const supervisor = await ctxFor(h.db, org, "supervisor");
    const gerente = await ctxFor(h.db, org, "gerente");
    const agenteId = org.members.agente?.userId;
    const lejanoId = org.members.agenteLejano?.userId;

    const leadDelAgente = {
      organizationId: org.organizationId,
      ownerUserId: agenteId,
      branchId: org.branchIds.main,
    };
    const leadLejano = {
      organizationId: org.organizationId,
      ownerUserId: lejanoId,
      branchId: org.branchIds.second,
    };

    expect(hasPermission(agente, "lead.update", leadDelAgente)).toBe(true);
    expect(hasPermission(agente, "lead.update", leadLejano)).toBe(false);
    expect(hasPermission(supervisor, "lead.update", leadDelAgente)).toBe(true);
    expect(hasPermission(supervisor, "lead.update", leadLejano)).toBe(false);
    expect(hasPermission(gerente, "lead.update", leadLejano)).toBe(true);
    expect(hasPermission(gerente, "lead.update", leadDelAgente)).toBe(false);
  });

  it("ningún rol accede a registros de otra organización", async () => {
    const superadmin = await ctxFor(h.db, org, "superadmin");
    const foreign = {
      organizationId: "00000000-0000-0000-0000-000000000000",
      ownerUserId: superadmin.userId,
    };
    for (const code of PERMISSION_CODES) expect(hasPermission(superadmin, code, foreign)).toBe(false);
  });

  it("scopeCondition filtra en SQL: el agente solo 've' su propia fila", async () => {
    const agente = await ctxFor(h.db, org, "agente");
    const admin = await ctxFor(h.db, org, "admin");
    const cols = { ownerUserId: membership.userId, branchId: membership.defaultBranchId };

    const visibleForAgent = await h.db
      .select({ userId: membership.userId })
      .from(membership)
      .where(scopeCondition(agente, "lead.read", cols));
    expect(visibleForAgent.map((r) => r.userId)).toEqual([agente.userId]);

    const visibleForAdmin = await h.db
      .select()
      .from(membership)
      .where(scopeCondition(admin, "lead.read", cols));
    expect(visibleForAdmin.length).toBe(Object.keys(ROLES).length);

    const none = await h.db
      .select()
      .from(membership)
      .where(scopeCondition(agente, "audit.read", cols));
    expect(none).toEqual([]);
  });
});

describe("contexto de sesión", () => {
  it("un usuario suspendido no obtiene contexto", async () => {
    const m = org.members.recepcion;
    if (!m) throw new Error("fixture");
    await setStatus(h.db, m.membershipId, "suspended");
    await expect(loadContext(h.db, { userId: m.userId })).rejects.toBeInstanceOf(UnauthenticatedError);
    await setStatus(h.db, m.membershipId, "active");
    const [row] = await h.db.select().from(membership).where(eq(membership.id, m.membershipId));
    expect(row?.status).toBe("active");
  });
});
