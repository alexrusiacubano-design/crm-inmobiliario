export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "user.create": "Alta de usuario",
  "user.update": "Edición de usuario",
  "user.suspend": "Suspensión de usuario",
  "user.reactivate": "Reactivación de usuario",
  "user.password_reset": "Cambio de contraseña",
  "permission.assignment_change": "Cambio de roles asignados",
  "permission.role_change": "Cambio de permisos de rol",
  "role.create": "Alta de rol",
  "role.delete": "Baja de rol",
  "branch.create": "Alta de sucursal",
  "branch.update": "Edición de sucursal",
  "branch.status_change": "Cambio de estado de sucursal",
  "team.create": "Alta de equipo",
  "team.update": "Edición de equipo",
  "team.members_change": "Cambio de miembros de equipo",
  "organization.update": "Cambio de configuración",
  "contact.create": "Alta de contacto",
  "contact.update": "Edición de contacto",
  "contact.delete": "Baja de contacto",
  "contact.assignment_change": "Cambio de responsable de contacto",
  "contact.merge": "Fusión de contactos",
  "contact.duplicate_dismissed": "Duplicado descartado",
  "lead.create": "Alta de lead",
  "lead.status_change": "Cambio de etapa de lead",
  "lead.assignment_change": "Reasignación de lead",
  "lead.search_update": "Cambio de búsqueda",
  "owner.create": "Alta de propietario",
  "owner.update": "Edición de propietario",
  "owner.financial_update": "Cambio de datos bancarios",
  "owner.financial_view": "Consulta de cuenta bancaria",
};

export const AUDIT_ENTITY_LABELS: Record<string, string> = {
  user: "Usuario",
  role: "Rol",
  branch: "Sucursal",
  team: "Equipo",
  organization: "Organización",
  contact: "Contacto",
  lead: "Lead",
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}
