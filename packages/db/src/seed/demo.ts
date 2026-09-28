import { eq } from "drizzle-orm";
import type { DbOrTx } from "../index";
import { insertCredentialUser } from "../credentials";
import { branch, membership, membershipRole, organization, team, teamMember, user } from "../schema";
import { ensureSystemRoles } from "./catalog";

/**
 * Organización DEMO para desarrollo. Todo lo que crea está marcado como demostración:
 * la organización tiene `is_demo = true` y los nombres llevan "(DEMO)".
 * Los emails usan el dominio reservado example.com, que no recibe correo real.
 */

export const DEMO_ORG_SLUG = "demo";
export const DEMO_EMAIL_DOMAIN = "demo.example.com";

interface DemoUser {
  key: string;
  name: string;
  roleKey: string;
  branchCode: string | null;
  /** Rol limitado a la sucursal (para demostrar asignaciones por sucursal). */
  roleBranchOnly?: boolean;
  teams: string[];
  jobTitle: string;
}

const BRANCHES = [
  { code: "MVD-POC", name: "Pocitos (DEMO)", address: "Av. Brasil 2500, Montevideo" },
  { code: "MVD-CAR", name: "Carrasco (DEMO)", address: "Av. Arocena 1600, Montevideo" },
  { code: "MAL-PDE", name: "Punta del Este (DEMO)", address: "Av. Gorlero 900, Punta del Este" },
] as const;

const TEAMS = [
  { key: "ventas-poc", name: "Ventas Pocitos", branchCode: "MVD-POC" },
  { key: "alquileres-poc", name: "Alquileres Pocitos", branchCode: "MVD-POC" },
  { key: "ventas-car", name: "Ventas Carrasco", branchCode: "MVD-CAR" },
  { key: "pde", name: "Punta del Este", branchCode: "MAL-PDE" },
] as const;

export const DEMO_USERS: readonly DemoUser[] = [
  {
    key: "superadmin",
    name: "Sofía Demo",
    roleKey: "super_admin",
    branchCode: null,
    teams: [],
    jobTitle: "Super Admin",
  },
  {
    key: "admin",
    name: "Andrés Demo",
    roleKey: "admin",
    branchCode: "MVD-POC",
    teams: [],
    jobTitle: "Administrador",
  },
  {
    key: "director",
    name: "Daniela Demo",
    roleKey: "director",
    branchCode: "MVD-POC",
    teams: [],
    jobTitle: "Directora",
  },
  {
    key: "gerente",
    name: "Gonzalo Demo",
    roleKey: "manager",
    branchCode: "MVD-CAR",
    roleBranchOnly: true,
    teams: [],
    jobTitle: "Gerente Carrasco",
  },
  {
    key: "supervisor",
    name: "Valentina Demo",
    roleKey: "supervisor",
    branchCode: "MVD-POC",
    teams: ["ventas-poc"],
    jobTitle: "Supervisora de ventas",
  },
  {
    key: "agente",
    name: "Martín Demo",
    roleKey: "agent",
    branchCode: "MVD-POC",
    teams: ["ventas-poc"],
    jobTitle: "Agente",
  },
  {
    key: "agente2",
    name: "Lucía Demo",
    roleKey: "agent",
    branchCode: "MAL-PDE",
    teams: ["pde"],
    jobTitle: "Agente Punta del Este",
  },
  {
    key: "administracion",
    name: "Carolina Demo",
    roleKey: "rental_admin",
    branchCode: "MVD-POC",
    teams: ["alquileres-poc"],
    jobTitle: "Administración de alquileres",
  },
  {
    key: "contabilidad",
    name: "Federico Demo",
    roleKey: "accounting",
    branchCode: "MVD-POC",
    teams: [],
    jobTitle: "Contador",
  },
  {
    key: "recepcion",
    name: "Paula Demo",
    roleKey: "reception",
    branchCode: "MVD-POC",
    teams: [],
    jobTitle: "Recepción",
  },
];

export const demoEmail = (key: string): string => `${key}@${DEMO_EMAIL_DOMAIN}`;

export async function seedDemoOrganization(
  db: DbOrTx,
  password: string,
): Promise<{ organizationId: string; created: boolean }> {
  const [existing] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.slug, DEMO_ORG_SLUG));
  if (existing) {
    await ensureSystemRoles(db, existing.id);
    return { organizationId: existing.id, created: false };
  }

  const [org] = await db
    .insert(organization)
    .values({ name: "Inmobiliaria Demo (DEMO)", slug: DEMO_ORG_SLUG, isDemo: true, defaultCurrency: "USD" })
    .returning({ id: organization.id });
  if (!org) throw new Error("No se pudo crear la organización DEMO");

  const roleIds = await ensureSystemRoles(db, org.id);

  const branchIds = new Map<string, string>();
  for (const b of BRANCHES) {
    const [row] = await db
      .insert(branch)
      .values({ organizationId: org.id, code: b.code, name: b.name, address: b.address })
      .returning({ id: branch.id });
    if (!row) throw new Error("No se pudo crear la sucursal");
    branchIds.set(b.code, row.id);
  }

  const teamIds = new Map<string, string>();
  for (const t of TEAMS) {
    const branchId = branchIds.get(t.branchCode);
    if (!branchId) throw new Error(`Sucursal inexistente ${t.branchCode}`);
    const [row] = await db
      .insert(team)
      .values({ organizationId: org.id, branchId, name: t.name })
      .returning({ id: team.id });
    if (!row) throw new Error("No se pudo crear el equipo");
    teamIds.set(t.key, row.id);
  }

  for (const u of DEMO_USERS) {
    const email = demoEmail(u.key);
    const [prior] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
    const userId = prior?.id ?? (await insertCredentialUser(db, { name: u.name, email, password })).id;
    const defaultBranchId = u.branchCode ? (branchIds.get(u.branchCode) ?? null) : null;
    const [m] = await db
      .insert(membership)
      .values({ organizationId: org.id, userId, defaultBranchId, jobTitle: u.jobTitle })
      .returning({ id: membership.id });
    if (!m) throw new Error("No se pudo crear la membresía");

    const roleId = roleIds.get(u.roleKey);
    if (!roleId) throw new Error(`Rol inexistente ${u.roleKey}`);
    await db.insert(membershipRole).values({
      organizationId: org.id,
      membershipId: m.id,
      roleId,
      branchId: u.roleBranchOnly ? defaultBranchId : null,
    });

    for (const teamKey of u.teams) {
      const teamId = teamIds.get(teamKey);
      if (!teamId) throw new Error(`Equipo inexistente ${teamKey}`);
      await db.insert(teamMember).values({ organizationId: org.id, teamId, membershipId: m.id });
      if (u.roleKey === "supervisor") {
        await db.update(team).set({ leadMembershipId: m.id }).where(eq(team.id, teamId));
      }
    }
  }

  return { organizationId: org.id, created: true };
}
