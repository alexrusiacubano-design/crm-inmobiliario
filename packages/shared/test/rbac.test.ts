import { describe, expect, it } from "vitest";
import {
  accessFilter,
  can,
  PERMISSION_CODES,
  PERMISSION_DEFS,
  SYSTEM_ROLES,
  widestScope,
  type ResolvedGrant,
  type Subject,
} from "../src/rbac";

const ORG = "org-1";
const subject: Subject = {
  userId: "u-agent",
  organizationId: ORG,
  branchIds: ["b-pocitos"],
  teamIds: ["t-ventas"],
  teamMateUserIds: ["u-agent", "u-mate"],
};

const g = (
  code: ResolvedGrant["code"],
  scope: ResolvedGrant["scope"],
  restrictedToBranchId: string | null = null,
): ResolvedGrant => ({
  code,
  scope,
  restrictedToBranchId,
});

describe("evaluación de alcance", () => {
  const own = { organizationId: ORG, ownerUserId: "u-agent", branchId: "b-pocitos", teamId: "t-ventas" };
  const mate = { organizationId: ORG, ownerUserId: "u-mate", branchId: "b-pocitos", teamId: null };
  const sameBranch = { organizationId: ORG, ownerUserId: "u-other", branchId: "b-pocitos", teamId: "t-otro" };
  const otherBranch = { organizationId: ORG, ownerUserId: "u-far", branchId: "b-carrasco", teamId: "t-car" };
  const otherOrg = { organizationId: "org-2", ownerUserId: "u-agent", branchId: "b-pocitos" };

  it("own: solo registros propios", () => {
    const grants = [g("lead.read", "own")];
    expect(can(grants, subject, "lead.read", own)).toBe(true);
    expect(can(grants, subject, "lead.read", mate)).toBe(false);
    expect(can(grants, subject, "lead.read", sameBranch)).toBe(false);
  });

  it("team: propios, del equipo y de compañeros", () => {
    const grants = [g("lead.read", "team")];
    expect(can(grants, subject, "lead.read", own)).toBe(true);
    expect(can(grants, subject, "lead.read", mate)).toBe(true);
    expect(can(grants, subject, "lead.read", sameBranch)).toBe(false);
  });

  it("branch: toda su sucursal, no otras", () => {
    const grants = [g("lead.read", "branch")];
    expect(can(grants, subject, "lead.read", sameBranch)).toBe(true);
    expect(can(grants, subject, "lead.read", otherBranch)).toBe(false);
  });

  it("org: todo dentro de la organización, nunca otra organización", () => {
    const grants = [g("lead.read", "org")];
    expect(can(grants, subject, "lead.read", otherBranch)).toBe(true);
    expect(can(grants, subject, "lead.read", otherOrg)).toBe(false);
  });

  it("rol limitado a sucursal: org se reduce a esa sucursal", () => {
    const grants = [g("lead.read", "org", "b-carrasco")];
    expect(can(grants, subject, "lead.read", otherBranch)).toBe(true);
    expect(can(grants, subject, "lead.read", sameBranch)).toBe(false);
    expect(widestScope(grants, "lead.read")).toBe("branch");
  });

  it("sin permiso no hay acceso aunque el registro sea propio", () => {
    expect(can([g("lead.read", "org")], subject, "lead.update", own)).toBe(false);
  });

  it("accessFilter describe el filtro SQL a aplicar", () => {
    expect(accessFilter([], subject, "lead.read")).toEqual({ kind: "none" });
    expect(accessFilter([g("lead.read", "org")], subject, "lead.read")).toEqual({ kind: "all" });
    const team = accessFilter([g("lead.read", "team")], subject, "lead.read");
    expect(team).toMatchObject({ kind: "some", teamIds: ["t-ventas"], branchIds: [] });
    expect(team.kind === "some" && [...team.ownerUserIds].sort()).toEqual(["u-agent", "u-mate"]);
  });
});

describe("catálogo y roles de sistema", () => {
  it("los códigos son únicos y con formato modulo.accion", () => {
    expect(new Set(PERMISSION_CODES).size).toBe(PERMISSION_CODES.length);
    for (const code of PERMISSION_CODES) expect(code).toMatch(/^[a-z]+(\.[a-z]+)+$/);
  });

  it("existen los 9 roles iniciales", () => {
    expect(SYSTEM_ROLES.map((r) => r.name)).toEqual([
      "Super Admin",
      "Administrador",
      "Director",
      "Gerente",
      "Supervisor",
      "Agente",
      "Administración",
      "Contabilidad",
      "Recepción",
    ]);
  });

  it("los permisos no-scopables solo se otorgan a nivel org", () => {
    const nonScopable = new Set(PERMISSION_DEFS.filter((p) => !p.scopable).map((p) => p.code));
    for (const r of SYSTEM_ROLES) {
      for (const [code, scope] of r.grants) {
        if (nonScopable.has(code)) expect(scope, `${r.key}:${code}`).toBe("org");
      }
    }
  });

  it("Super Admin tiene todo; Agente no administra ni ve finanzas de propietarios", () => {
    const superAdmin = SYSTEM_ROLES.find((r) => r.key === "super_admin");
    expect(superAdmin?.grants.length).toBe(PERMISSION_CODES.length);
    const agent = new Map(SYSTEM_ROLES.find((r) => r.key === "agent")?.grants);
    expect(agent.get("lead.read")).toBe("own");
    expect(agent.get("property.read")).toBe("org");
    for (const forbidden of [
      "users.manage",
      "roles.manage",
      "audit.read",
      "owner.financial.read",
      "commission.manage",
    ] as const) {
      expect(agent.has(forbidden), forbidden).toBe(false);
    }
  });
});
