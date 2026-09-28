import { and, eq, sql } from "drizzle-orm";
import { PERMISSION_DEFS, SYSTEM_ROLES } from "@crm/shared/rbac";
import type { DbOrTx } from "../index";
import { country, department, locality, neighborhood, permission, role, rolePermission } from "../schema";
import { URUGUAY_GEO } from "./geo-uy";

/** Sincroniza la tabla `permission` con el catálogo en código (idempotente). */
export async function syncPermissions(db: DbOrTx): Promise<void> {
  for (const p of PERMISSION_DEFS) {
    await db
      .insert(permission)
      .values({
        code: p.code,
        module: p.module,
        label: p.label,
        scopable: p.scopable,
        sensitive: p.sensitive ?? false,
      })
      .onConflictDoUpdate({
        target: permission.code,
        set: { module: p.module, label: p.label, scopable: p.scopable, sensitive: p.sensitive ?? false },
      });
  }
}

/**
 * Crea los roles de sistema que falten en una organización. Los existentes NO se
 * sobrescriben (la organización pudo editarlos), salvo los bloqueados, que siempre
 * reflejan el catálogo.
 */
export async function ensureSystemRoles(db: DbOrTx, organizationId: string): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const def of SYSTEM_ROLES) {
    const [existing] = await db
      .select({ id: role.id })
      .from(role)
      .where(and(eq(role.organizationId, organizationId), eq(role.key, def.key)));

    let roleId = existing?.id;
    if (!roleId) {
      const [created] = await db
        .insert(role)
        .values({
          organizationId,
          key: def.key,
          name: def.name,
          description: def.description,
          isSystem: true,
          isLocked: def.locked,
        })
        .returning({ id: role.id });
      if (!created) throw new Error(`No se pudo crear el rol ${def.key}`);
      roleId = created.id;
    } else if (!def.locked) {
      ids.set(def.key, roleId);
      continue;
    }

    await db.delete(rolePermission).where(eq(rolePermission.roleId, roleId));
    if (def.grants.length > 0) {
      await db
        .insert(rolePermission)
        .values(def.grants.map(([code, scope]) => ({ roleId: roleId, permissionCode: code, scope })));
    }
    ids.set(def.key, roleId);
  }
  return ids;
}

/** Carga el catálogo geográfico de Uruguay (idempotente). */
export async function seedGeoUruguay(db: DbOrTx): Promise<void> {
  await db.insert(country).values({ code: "UY", name: "Uruguay" }).onConflictDoNothing();

  for (const [deptName, localities] of Object.entries(URUGUAY_GEO)) {
    await db.insert(department).values({ countryCode: "UY", name: deptName }).onConflictDoNothing();
    const [dept] = await db
      .select({ id: department.id })
      .from(department)
      .where(and(eq(department.countryCode, "UY"), eq(department.name, deptName)));
    if (!dept) throw new Error(`Departamento no encontrado: ${deptName}`);

    for (const loc of localities) {
      await db.insert(locality).values({ departmentId: dept.id, name: loc.name }).onConflictDoNothing();
      const [row] = await db
        .select({ id: locality.id })
        .from(locality)
        .where(and(eq(locality.departmentId, dept.id), eq(locality.name, loc.name)));
      if (!row) throw new Error(`Localidad no encontrada: ${loc.name}`);
      if (loc.neighborhoods?.length) {
        await db
          .insert(neighborhood)
          .values(loc.neighborhoods.map((name) => ({ localityId: row.id, name })))
          .onConflictDoNothing();
      }
    }
  }
}

export async function countGeo(
  db: DbOrTx,
): Promise<{ departments: number; localities: number; neighborhoods: number }> {
  const [d] = await db.select({ n: sql<number>`count(*)::int` }).from(department);
  const [l] = await db.select({ n: sql<number>`count(*)::int` }).from(locality);
  const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(neighborhood);
  return { departments: d?.n ?? 0, localities: l?.n ?? 0, neighborhoods: n?.n ?? 0 };
}
