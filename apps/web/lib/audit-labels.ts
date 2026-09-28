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
};

export const AUDIT_ENTITY_LABELS: Record<string, string> = {
  user: "Usuario",
  role: "Rol",
  branch: "Sucursal",
  team: "Equipo",
  organization: "Organización",
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}
