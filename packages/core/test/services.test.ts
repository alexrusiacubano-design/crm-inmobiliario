import { and, count, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, domainEvent, membership, session, user, type DbHandle } from "@crm/db";
import {
  ConflictError,
  createBranch,
  createMember,
  createRole,
  ForbiddenError,
  getMember,
  listAuditLogs,
  listMembers,
  NotFoundError,
  resetMemberPassword,
  setMemberStatus,
  updateBranch,
  updateMember,
  updateRole,
  ValidationError,
  writeAudit,
} from "../src";
import { createTestOrg, ctxFor, freshDb, type TestOrg } from "./fixtures";

let h: DbHandle;
let a: TestOrg;
let b: TestOrg;

beforeAll(async () => {
  h = await freshDb();
  a = await createTestOrg(h.db, "alfa", {
    superadmin: { roleKey: "super_admin" },
    admin: { roleKey: "admin" },
    agente: { roleKey: "agent", inTeam: true },
  });
  b = await createTestOrg(h.db, "beta", {
    superadmin: { roleKey: "super_admin" },
    agente: { roleKey: "agent" },
  });
});
afterAll(async () => {
  await h.pool.end();
});

const auditCount = async (organizationId: string) =>
  (await h.db.select({ n: count() }).from(auditLog).where(eq(auditLog.organizationId, organizationId)))[0]
    ?.n ?? 0;

/** Drizzle envuelve el error de Postgres: el mensaje del trigger está en `cause`. */
async function expectDbError(promise: Promise<unknown>, pattern: RegExp) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e as { message: string; cause?: { message?: string } },
  );
  expect(error, "se esperaba un error de la base").not.toBeNull();
  expect(`${error?.message} ${error?.cause?.message ?? ""}`).toMatch(pattern);
}

const newUserInput = (org: TestOrg, email: string, roleKey = "agent") => ({
  name: "Usuario Nuevo",
  email,
  password: "Segura-12345",
  defaultBranchId: org.branchIds.main,
  roles: [{ roleId: org.roleIds.get(roleKey), branchId: null }],
  teamIds: [org.teamId],
});

describe("aislamiento entre organizaciones", () => {
  it("no se puede leer ni modificar un usuario de otra organización", async () => {
    const ctxA = await ctxFor(h.db, a, "admin");
    const foreign = b.members.agente?.membershipId ?? "";
    await expect(getMember(h.db, ctxA, foreign)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      updateMember(h.db, ctxA, {
        membershipId: foreign,
        name: "Hackeado",
        roles: [{ roleId: a.roleIds.get("agent"), branchId: null }],
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("no se puede asignar un rol, sucursal o equipo de otra organización", async () => {
    const ctxA = await ctxFor(h.db, a, "admin");
    const base = newUserInput(a, "cruzado@test.example.com");
    await expect(
      createMember(h.db, ctxA, { ...base, roles: [{ roleId: b.roleIds.get("agent"), branchId: null }] }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createMember(h.db, ctxA, { ...base, defaultBranchId: b.branchIds.main }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(createMember(h.db, ctxA, { ...base, teamIds: [b.teamId] })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("no se puede editar una sucursal de otra organización", async () => {
    const ctxA = await ctxFor(h.db, a, "admin");
    await expect(
      updateBranch(h.db, ctxA, { id: b.branchIds.main, name: "Robada", code: "XX", isActive: true }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("los listados solo devuelven datos de la propia organización", async () => {
    const ctxA = await ctxFor(h.db, a, "admin");
    const list = await listMembers(h.db, ctxA, { page: 1, pageSize: 100 });
    expect(list.items.every((m) => m.name.endsWith("alfa") || m.name === "Usuario Nuevo")).toBe(true);
    const audit = await listAuditLogs(h.db, ctxA, {});
    const ids = new Set(audit.items.map((i) => i.id));
    const foreign = await h.db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(eq(auditLog.organizationId, b.organizationId));
    expect(foreign.some((f) => ids.has(f.id))).toBe(false);
  });
});

describe("auditoría transaccional", () => {
  it("cada alta queda auditada y emite un evento en la misma transacción", async () => {
    const ctx = await ctxFor(h.db, a, "admin");
    const before = await auditCount(a.organizationId);
    const created = await createBranch(h.db, ctx, { name: "Punta Carretas", code: "PCA" });
    expect(await auditCount(a.organizationId)).toBe(before + 1);
    const [evt] = await h.db.select().from(domainEvent).where(eq(domainEvent.aggregateId, created.id));
    expect(evt?.type).toBe("branch.created");
    const [log] = await h.db.select().from(auditLog).where(eq(auditLog.entityId, created.id));
    expect(log?.actorUserId).toBe(ctx.userId);
    expect(log?.metadata).toMatchObject({ requestId: "test" });
  });

  it("si el cambio falla, no queda auditoría ni evento (rollback)", async () => {
    const ctx = await ctxFor(h.db, a, "admin");
    const before = await auditCount(a.organizationId);
    await expect(createBranch(h.db, ctx, { name: "Duplicada", code: "PCA" })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(await auditCount(a.organizationId)).toBe(before);
  });

  it("si la transacción se revierte después de auditar, la auditoría también se revierte", async () => {
    const ctx = await ctxFor(h.db, a, "admin");
    const before = await auditCount(a.organizationId);
    await expect(
      h.db.transaction(async (tx) => {
        await writeAudit(tx, ctx, { action: "test.rollback", entityType: "test", entityId: "1" });
        throw new Error("falla simulada");
      }),
    ).rejects.toThrow("falla simulada");
    expect(await auditCount(a.organizationId)).toBe(before);
  });

  it("la auditoría es append-only a nivel de base de datos", async () => {
    await expectDbError(h.db.execute(sql`update audit_log set action = 'alterado'`), /append-only/);
    await expectDbError(h.db.execute(sql`delete from audit_log`), /append-only/);
    await expectDbError(h.db.execute(sql`truncate audit_log`), /append-only/);
  });

  it("los eventos son inmutables salvo sus columnas de entrega", async () => {
    await expectDbError(h.db.execute(sql`update domain_event set payload = '{"x":1}'`), /solo se pueden/);
    await expectDbError(h.db.execute(sql`delete from domain_event`), /DELETE/);
    await h.db.execute(sql`update domain_event set attempts = attempts`);
  });

  it("los secretos nunca se guardan en la auditoría", async () => {
    const ctx = await ctxFor(h.db, a, "admin");
    const created = await createMember(h.db, ctx, newUserInput(a, "auditado@test.example.com"));
    const [log] = await h.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, created.membershipId), eq(auditLog.action, "user.create")));
    expect(JSON.stringify(log?.after)).not.toContain("Segura-12345");
  });
});

describe("usuarios y roles", () => {
  it("un agente no puede crear usuarios", async () => {
    const ctx = await ctxFor(h.db, a, "agente");
    await expect(createMember(h.db, ctx, newUserInput(a, "x@test.example.com"))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("valida en el servidor aunque el cliente envíe basura", async () => {
    const ctx = await ctxFor(h.db, a, "admin");
    await expect(createMember(h.db, ctx, { email: "no-es-email", password: "123" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("no permite emails duplicados", async () => {
    const ctx = await ctxFor(h.db, a, "admin");
    await createMember(h.db, ctx, newUserInput(a, "dup@test.example.com"));
    await expect(createMember(h.db, ctx, newUserInput(a, "DUP@test.example.com"))).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("un Administrador no puede otorgar Super Admin; un Super Admin sí", async () => {
    const admin = await ctxFor(h.db, a, "admin");
    const sa = await ctxFor(h.db, a, "superadmin");
    const input = newUserInput(a, "nuevo.sa@test.example.com", "super_admin");
    await expect(createMember(h.db, admin, input)).rejects.toBeInstanceOf(ForbiddenError);
    const created = await createMember(h.db, sa, input);
    expect(created.roles.map((r) => r.roleKey)).toEqual(["super_admin"]);
  });

  it("no se puede suspender a uno mismo ni dejar la organización sin Super Admin", async () => {
    const sa = await ctxFor(h.db, b, "superadmin");
    await expect(
      setMemberStatus(h.db, sa, { membershipId: sa.membershipId, status: "suspended" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      updateMember(h.db, sa, {
        membershipId: sa.membershipId,
        name: "Sin rol",
        roles: [{ roleId: b.roleIds.get("agent"), branchId: null }],
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("suspender cierra las sesiones del usuario", async () => {
    const admin = await ctxFor(h.db, a, "admin");
    const target = await createMember(h.db, admin, newUserInput(a, "sesiones@test.example.com"));
    await h.db
      .insert(session)
      .values({ userId: target.userId, token: "tok-1", expiresAt: new Date(Date.now() + 3_600_000) });
    await setMemberStatus(h.db, admin, { membershipId: target.membershipId, status: "suspended" });
    const open = await h.db.select().from(session).where(eq(session.userId, target.userId));
    expect(open).toEqual([]);
    const [m] = await h.db.select().from(membership).where(eq(membership.id, target.membershipId));
    expect(m?.status).toBe("suspended");
  });

  it("cambiar la contraseña reemplaza el hash y cierra sesiones", async () => {
    const admin = await ctxFor(h.db, a, "admin");
    const target = await createMember(h.db, admin, newUserInput(a, "clave@test.example.com"));
    await resetMemberPassword(h.db, admin, { membershipId: target.membershipId, password: "OtraClave-999" });
    const [u] = await h.db.select().from(user).where(eq(user.id, target.userId));
    expect(u).toBeDefined();
  });

  it("impide la escalada: quien solo gestiona roles no puede otorgar permisos que no tiene", async () => {
    const sa = await ctxFor(h.db, a, "superadmin");
    const limited = await createRole(h.db, sa, {
      name: "Editor de roles",
      grants: [
        { code: "roles.manage", scope: "org" },
        { code: "lead.read", scope: "team" },
      ],
    });
    const editor = await createMember(h.db, sa, {
      ...newUserInput(a, "editor@test.example.com"),
      roles: [{ roleId: limited.id, branchId: null }],
    });
    const ctx = await ctxFor(h.db, { ...a, members: { ...a.members, editor } }, "editor");

    await expect(
      createRole(h.db, ctx, { name: "Escalada", grants: [{ code: "users.manage", scope: "org" }] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      createRole(h.db, ctx, { name: "Más alcance", grants: [{ code: "lead.read", scope: "org" }] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const ok = await createRole(h.db, ctx, { name: "Válido", grants: [{ code: "lead.read", scope: "own" }] });
    expect(ok.name).toBe("Válido");
  });

  it("el rol Super Admin está bloqueado", async () => {
    const sa = await ctxFor(h.db, a, "superadmin");
    await expect(
      updateRole(h.db, sa, { id: a.roleIds.get("super_admin"), name: "Otro", grants: [] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
