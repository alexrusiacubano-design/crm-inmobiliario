/**
 * Catálogo de permisos. Es la ÚNICA fuente de verdad: el seed lo sincroniza con la tabla
 * `permission` y el servidor rechaza cualquier código que no esté aquí.
 *
 * `scopable: true` → el permiso se otorga con un alcance (own/team/branch/org) y se evalúa
 * contra el registro concreto. `scopable: false` → permiso de organización (solo "org").
 */

export const SCOPES = ["own", "team", "branch", "org"] as const;
export type Scope = (typeof SCOPES)[number];

/** Orden de amplitud: un alcance mayor incluye a los menores. */
export const SCOPE_RANK: Record<Scope, number> = { own: 1, team: 2, branch: 3, org: 4 };

export const SCOPE_LABELS: Record<Scope, string> = {
  own: "Propios",
  team: "Equipo",
  branch: "Sucursal",
  org: "Toda la organización",
};

interface PermissionDef {
  readonly code: string;
  readonly module: string;
  readonly label: string;
  readonly scopable: boolean;
  /** Permisos que exponen información sensible (se destacan en la UI de roles). */
  readonly sensitive?: boolean;
}

const def = (
  code: string,
  module: string,
  label: string,
  scopable = true,
  sensitive = false,
): PermissionDef => ({
  code,
  module,
  label,
  scopable,
  sensitive,
});

export const PERMISSION_DEFS = [
  // Dashboard y reportes
  def("dashboard.read", "dashboard", "Ver dashboard"),
  def("report.read", "reports", "Ver reportes"),

  // CRM
  def("contact.read", "crm", "Ver contactos"),
  def("contact.create", "crm", "Crear contactos"),
  def("contact.update", "crm", "Editar contactos"),
  def("contact.delete", "crm", "Dar de baja contactos"),
  def("contact.merge", "crm", "Fusionar contactos duplicados"),
  def("contact.identity.read", "crm", "Ver documento de identidad", true, true),
  def("lead.read", "crm", "Ver leads"),
  def("lead.create", "crm", "Crear leads"),
  def("lead.update", "crm", "Editar leads"),
  def("lead.delete", "crm", "Dar de baja leads"),
  def("lead.assign", "crm", "Asignar leads a agentes"),
  def("owner.read", "crm", "Ver propietarios"),
  def("owner.update", "crm", "Editar propietarios"),
  def("owner.financial.read", "crm", "Ver datos bancarios de propietarios", true, true),
  def("owner.financial.update", "crm", "Editar datos bancarios de propietarios", true, true),

  // Inmuebles
  def("property.read", "properties", "Ver propiedades"),
  def("property.create", "properties", "Crear propiedades"),
  def("property.update", "properties", "Editar propiedades"),
  def("property.delete", "properties", "Retirar propiedades"),
  def("property.price.update", "properties", "Cambiar precios"),
  def("property.price.floor.read", "properties", "Ver precio mínimo autorizado", true, true),
  def("acquisition.read", "properties", "Ver captaciones"),
  def("acquisition.manage", "properties", "Gestionar captaciones"),
  def("valuation.read", "properties", "Ver tasaciones"),
  def("valuation.manage", "properties", "Gestionar tasaciones"),
  def("publication.read", "properties", "Ver publicaciones en portales"),
  def("publication.manage", "properties", "Gestionar publicaciones en portales"),

  // Comercial
  def("matching.run", "commercial", "Ejecutar matching"),
  def("visit.read", "commercial", "Ver visitas"),
  def("visit.manage", "commercial", "Gestionar visitas"),
  def("offer.read", "commercial", "Ver ofertas"),
  def("offer.manage", "commercial", "Registrar ofertas y contraofertas"),
  def("reservation.read", "commercial", "Ver reservas"),
  def("reservation.manage", "commercial", "Gestionar reservas"),
  def("deal.read", "commercial", "Ver operaciones"),
  def("deal.manage", "commercial", "Gestionar operaciones"),
  def("deal.close", "commercial", "Cerrar operaciones"),

  // Agenda y tareas
  def("calendar.read", "agenda", "Ver agenda"),
  def("task.read", "agenda", "Ver tareas"),
  def("task.manage", "agenda", "Gestionar tareas"),

  // Alquileres
  def("contract.read", "rentals", "Ver contratos"),
  def("contract.manage", "rentals", "Gestionar contratos"),
  def("guarantee.read", "rentals", "Ver garantías"),
  def("guarantee.manage", "rentals", "Gestionar garantías"),
  def("inventory.read", "rentals", "Ver inventarios"),
  def("inventory.manage", "rentals", "Gestionar inventarios"),
  def("rent.read", "rentals", "Ver cobros de alquiler"),
  def("rent.manage", "rentals", "Gestionar cobros de alquiler"),
  def("payment.register", "rentals", "Registrar pagos", true, true),
  def("payment.void", "rentals", "Anular pagos (contra-asiento)", true, true),
  def("settlement.read", "rentals", "Ver liquidaciones", true, true),
  def("settlement.manage", "rentals", "Gestionar liquidaciones", true, true),

  // Finanzas
  def("commission.read", "finance", "Ver comisiones", true, true),
  def("commission.manage", "finance", "Gestionar comisiones", true, true),
  def("invoice.read", "finance", "Ver facturación", true, true),
  def("invoice.manage", "finance", "Gestionar facturación", true, true),

  // Documentos y comunicaciones
  def("document.read", "documents", "Ver documentos"),
  def("document.manage", "documents", "Subir y gestionar documentos"),
  def("document.sensitive.read", "documents", "Ver documentos confidenciales", true, true),
  def("communication.read", "communications", "Ver conversaciones"),
  def("communication.send", "communications", "Enviar mensajes"),
  def("template.manage", "communications", "Gestionar plantillas", false),

  // Administración (nivel organización)
  def("users.read", "admin", "Ver usuarios", false),
  def("users.manage", "admin", "Gestionar usuarios", false, true),
  def("teams.manage", "admin", "Gestionar equipos", false),
  def("branches.manage", "admin", "Gestionar sucursales", false),
  def("roles.manage", "admin", "Gestionar roles y permisos", false, true),
  def("audit.read", "admin", "Ver auditoría", false, true),
  def("settings.manage", "admin", "Gestionar configuración", false),
  def("integrations.manage", "admin", "Gestionar integraciones", false, true),
  def("automation.manage", "admin", "Gestionar automatizaciones", false),
] as const satisfies readonly PermissionDef[];

export type PermissionCode = (typeof PERMISSION_DEFS)[number]["code"];

export const PERMISSION_CODES: readonly PermissionCode[] = PERMISSION_DEFS.map((p) => p.code);

const BY_CODE = new Map<string, PermissionDef>(PERMISSION_DEFS.map((p) => [p.code, p]));

export function isPermissionCode(value: string): value is PermissionCode {
  return BY_CODE.has(value);
}

export function getPermissionDef(code: PermissionCode): PermissionDef {
  const found = BY_CODE.get(code);
  if (!found) throw new Error(`Permiso desconocido: ${code}`);
  return found;
}

export function isScopable(code: PermissionCode): boolean {
  return getPermissionDef(code).scopable;
}

export const PERMISSION_MODULE_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  reports: "Reportes",
  crm: "CRM",
  properties: "Inmuebles",
  commercial: "Comercial",
  agenda: "Agenda y tareas",
  rentals: "Alquileres",
  finance: "Finanzas",
  documents: "Documentos",
  communications: "Comunicaciones",
  admin: "Administración",
};
