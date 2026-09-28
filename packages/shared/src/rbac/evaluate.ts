import { SCOPE_RANK, type PermissionCode, type Scope } from "./permissions";

/**
 * Evaluación pura de permisos con alcance. No accede a la base: recibe los grants ya
 * resueltos del usuario y describe el registro sobre el que se quiere actuar.
 */

export interface ResolvedGrant {
  readonly code: PermissionCode;
  readonly scope: Scope;
  /**
   * Si el rol se asignó limitado a una sucursal, los alcances "org" y "branch" quedan
   * restringidos a esa sucursal. "team" y "own" no cambian.
   */
  readonly restrictedToBranchId: string | null;
}

export interface Subject {
  readonly userId: string;
  readonly organizationId: string;
  /** Sucursales a las que pertenece el usuario (sucursal por defecto + sucursales de sus equipos). */
  readonly branchIds: readonly string[];
  /** Equipos a los que pertenece. */
  readonly teamIds: readonly string[];
  /** Usuarios que comparten al menos un equipo con él (incluido él mismo). */
  readonly teamMateUserIds: readonly string[];
}

/** Lo mínimo que hay que saber de un registro para decidir acceso. */
export interface ResourceRef {
  readonly organizationId: string;
  readonly ownerUserId?: string | null;
  readonly branchId?: string | null;
  readonly teamId?: string | null;
}

function effectiveBranches(grant: ResolvedGrant, subject: Subject): readonly string[] | "all" {
  if (grant.restrictedToBranchId) return [grant.restrictedToBranchId];
  if (grant.scope === "org") return "all";
  return subject.branchIds;
}

export function grantAllows(grant: ResolvedGrant, subject: Subject, resource: ResourceRef): boolean {
  if (resource.organizationId !== subject.organizationId) return false;
  const isOwn = !!resource.ownerUserId && resource.ownerUserId === subject.userId;

  switch (grant.scope) {
    case "own":
      return isOwn;
    case "team":
      return (
        isOwn ||
        (!!resource.teamId && subject.teamIds.includes(resource.teamId)) ||
        (!!resource.ownerUserId && subject.teamMateUserIds.includes(resource.ownerUserId))
      );
    case "branch":
    case "org": {
      const branches = effectiveBranches(grant, subject);
      if (branches === "all") return true;
      return isOwn || (!!resource.branchId && branches.includes(resource.branchId));
    }
  }
}

export function can(
  grants: readonly ResolvedGrant[],
  subject: Subject,
  code: PermissionCode,
  resource?: ResourceRef,
): boolean {
  const relevant = grants.filter((g) => g.code === code);
  if (relevant.length === 0) return false;
  // Sin registro concreto: alcanza con tener el permiso en algún alcance (p. ej. para
  // mostrar un menú o permitir "crear").
  if (!resource) return true;
  return relevant.some((g) => grantAllows(g, subject, resource));
}

/** El alcance más amplio que tiene el usuario para un permiso (útil para la UI). */
export function widestScope(grants: readonly ResolvedGrant[], code: PermissionCode): Scope | null {
  let best: Scope | null = null;
  for (const g of grants) {
    if (g.code !== code) continue;
    const scope: Scope =
      g.restrictedToBranchId && (g.scope === "org" || g.scope === "branch") ? "branch" : g.scope;
    if (!best || SCOPE_RANK[scope] > SCOPE_RANK[best]) best = scope;
  }
  return best;
}

/**
 * Describe qué registros puede LISTAR el usuario para un permiso. El repositorio lo traduce a
 * condiciones SQL; así el filtrado ocurre en la base y no en el navegador.
 */
export type AccessFilter =
  | { readonly kind: "all" }
  | { readonly kind: "none" }
  | {
      readonly kind: "some";
      readonly ownerUserIds: readonly string[];
      readonly teamIds: readonly string[];
      readonly branchIds: readonly string[];
    };

export function accessFilter(
  grants: readonly ResolvedGrant[],
  subject: Subject,
  code: PermissionCode,
): AccessFilter {
  const relevant = grants.filter((g) => g.code === code);
  if (relevant.length === 0) return { kind: "none" };

  const owners = new Set<string>();
  const teams = new Set<string>();
  const branches = new Set<string>();

  for (const g of relevant) {
    owners.add(subject.userId);
    if (g.scope === "team") {
      subject.teamIds.forEach((t) => teams.add(t));
      subject.teamMateUserIds.forEach((u) => owners.add(u));
    }
    if (g.scope === "branch" || g.scope === "org") {
      const eff = effectiveBranches(g, subject);
      if (eff === "all") return { kind: "all" };
      eff.forEach((b) => branches.add(b));
    }
  }
  return { kind: "some", ownerUserIds: [...owners], teamIds: [...teams], branchIds: [...branches] };
}
