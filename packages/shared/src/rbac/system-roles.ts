import { PERMISSION_DEFS, type PermissionCode, type Scope } from "./permissions";

/**
 * Roles iniciales sembrados en cada organización. Son un punto de partida: la organización
 * puede editarlos (salvo Super Admin, bloqueado) y crear roles propios.
 */
export type Grant = readonly [PermissionCode, Scope];

export interface SystemRoleDef {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  /** Bloqueado: no se puede editar ni eliminar desde la UI. */
  readonly locked: boolean;
  readonly grants: readonly Grant[];
}

const ALL_CODES = PERMISSION_DEFS.map((p) => p.code);

function grant(scope: Scope, codes: readonly PermissionCode[]): Grant[] {
  return codes.map((code) => [code, scope] as const);
}

/** Otorga un permiso: los no-scopables siempre en "org". */
function normalize(grants: readonly Grant[]): Grant[] {
  const scopable = new Map<string, boolean>(PERMISSION_DEFS.map((p) => [p.code, p.scopable]));
  const merged = new Map<PermissionCode, Scope>();
  for (const [code, scope] of grants) {
    merged.set(code, scopable.get(code) ? scope : "org");
  }
  return [...merged.entries()];
}

const COMMERCIAL_READ: PermissionCode[] = [
  "dashboard.read",
  "contact.read",
  "lead.read",
  "owner.read",
  "property.read",
  "acquisition.read",
  "valuation.read",
  "publication.read",
  "visit.read",
  "offer.read",
  "reservation.read",
  "deal.read",
  "calendar.read",
  "task.read",
  "document.read",
  "communication.read",
];

const COMMERCIAL_WRITE: PermissionCode[] = [
  "contact.create",
  "contact.update",
  "lead.create",
  "lead.update",
  "owner.update",
  "property.create",
  "property.update",
  "property.price.update",
  "acquisition.manage",
  "valuation.manage",
  "matching.run",
  "visit.manage",
  "offer.manage",
  "reservation.manage",
  "deal.manage",
  "task.manage",
  "document.manage",
  "communication.send",
];

const RENTAL_ADMIN: PermissionCode[] = [
  "contract.read",
  "contract.manage",
  "guarantee.read",
  "guarantee.manage",
  "inventory.read",
  "inventory.manage",
  "rent.read",
  "rent.manage",
  "payment.register",
  "settlement.read",
  "settlement.manage",
];

export const SYSTEM_ROLES: readonly SystemRoleDef[] = [
  {
    key: "super_admin",
    name: "Super Admin",
    description: "Acceso total. Rol bloqueado.",
    locked: true,
    grants: normalize(grant("org", ALL_CODES)),
  },
  {
    key: "admin",
    name: "Administrador",
    description: "Administra la organización, usuarios, roles y configuración.",
    locked: false,
    grants: normalize(grant("org", ALL_CODES)),
  },
  {
    key: "director",
    name: "Director",
    description: "Visión y gestión comercial de toda la organización.",
    locked: false,
    grants: normalize([
      ...grant("org", COMMERCIAL_READ),
      ...grant("org", COMMERCIAL_WRITE),
      ...grant("org", [
        "report.read",
        "lead.assign",
        "deal.close",
        "contract.read",
        "rent.read",
        "commission.read",
        "settlement.read",
        "invoice.read",
        "property.price.floor.read",
        "contact.identity.read",
        "document.sensitive.read",
        "users.read",
        "audit.read",
      ]),
    ]),
  },
  {
    key: "manager",
    name: "Gerente",
    description: "Gestiona la operación comercial de su sucursal.",
    locked: false,
    grants: normalize([
      ...grant("branch", COMMERCIAL_READ),
      ...grant("branch", COMMERCIAL_WRITE),
      ...grant("branch", [
        "report.read",
        "lead.assign",
        "deal.close",
        "contract.read",
        "commission.read",
        "property.price.floor.read",
        "contact.identity.read",
      ]),
      ...grant("org", ["property.read", "users.read"]),
    ]),
  },
  {
    key: "supervisor",
    name: "Supervisor",
    description: "Supervisa y reasigna el trabajo de su equipo.",
    locked: false,
    grants: normalize([
      ...grant("team", COMMERCIAL_READ),
      ...grant("team", COMMERCIAL_WRITE),
      ...grant("team", ["report.read", "lead.assign", "property.price.floor.read", "contact.identity.read"]),
      ...grant("org", ["property.read", "users.read"]),
    ]),
  },
  {
    key: "agent",
    name: "Agente",
    description: "Trabaja sus propios leads, clientes, propiedades y visitas.",
    locked: false,
    grants: normalize([
      ...grant("own", COMMERCIAL_READ),
      ...grant("own", COMMERCIAL_WRITE),
      ...grant("own", ["contact.identity.read", "commission.read"]),
      // Todo agente necesita ver el inventario completo para ofrecerlo y hacer matching.
      ...grant("org", ["property.read", "publication.read"]),
    ]),
  },
  {
    key: "rental_admin",
    name: "Administración",
    description: "Administración de alquileres: contratos, garantías, cobros y liquidaciones.",
    locked: false,
    grants: normalize([
      ...grant("org", RENTAL_ADMIN),
      ...grant("org", [
        "dashboard.read",
        "contact.read",
        "contact.update",
        "contact.identity.read",
        "owner.read",
        "owner.update",
        "owner.financial.read",
        "property.read",
        "document.read",
        "document.manage",
        "document.sensitive.read",
        "communication.read",
        "communication.send",
        "task.read",
        "task.manage",
        "calendar.read",
        "report.read",
      ]),
    ]),
  },
  {
    key: "accounting",
    name: "Contabilidad",
    description: "Comisiones, facturación, pagos y liquidaciones.",
    locked: false,
    grants: normalize([
      ...grant("org", [
        "dashboard.read",
        "report.read",
        "contact.read",
        "owner.read",
        "owner.financial.read",
        "property.read",
        "deal.read",
        "contract.read",
        "rent.read",
        "payment.register",
        "payment.void",
        "settlement.read",
        "settlement.manage",
        "commission.read",
        "commission.manage",
        "invoice.read",
        "invoice.manage",
        "document.read",
        "document.sensitive.read",
      ]),
    ]),
  },
  {
    key: "reception",
    name: "Recepción",
    description: "Registra consultas y agenda visitas.",
    locked: false,
    grants: normalize([
      ...grant("org", [
        "contact.read",
        "contact.create",
        "lead.read",
        "lead.create",
        "property.read",
        "visit.read",
        "visit.manage",
        "calendar.read",
        "communication.read",
      ]),
      ...grant("own", ["task.read", "task.manage"]),
    ]),
  },
];

export function getSystemRole(key: string): SystemRoleDef | undefined {
  return SYSTEM_ROLES.find((r) => r.key === key);
}
