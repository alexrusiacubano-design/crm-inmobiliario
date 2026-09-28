/**
 * Textos de la interfaz. Español de Uruguay por defecto; la estructura permite agregar
 * otros idiomas sin tocar componentes. En la Fase 1 cubre navegación y textos comunes;
 * cada módulo nuevo agrega sus claves aquí.
 */
const es = {
  "app.name": "Inmobiliaria CRM",
  "common.save": "Guardar",
  "common.cancel": "Cancelar",
  "common.create": "Crear",
  "common.edit": "Editar",
  "common.search": "Buscar",
  "common.actions": "Acciones",
  "common.active": "Activo",
  "common.inactive": "Inactivo",
  "common.suspended": "Suspendido",
  "common.previous": "Anterior",
  "common.next": "Siguiente",
  "common.noResults": "Sin resultados",
  "common.demo": "DEMO",
  "nav.dashboard": "Dashboard",
  "nav.crm": "CRM",
  "nav.crm.leads": "Leads",
  "nav.crm.clients": "Clientes",
  "nav.crm.owners": "Propietarios",
  "nav.crm.contacts": "Contactos",
  "nav.properties": "Inmuebles",
  "nav.properties.list": "Propiedades",
  "nav.properties.acquisitions": "Captaciones",
  "nav.properties.valuations": "Tasaciones",
  "nav.properties.publications": "Publicaciones",
  "nav.commercial": "Comercial",
  "nav.commercial.matching": "Matching",
  "nav.commercial.visits": "Visitas",
  "nav.commercial.offers": "Ofertas",
  "nav.commercial.reservations": "Reservas",
  "nav.commercial.deals": "Operaciones",
  "nav.rentals": "Alquileres",
  "nav.rentals.guarantees": "Garantías",
  "nav.rentals.contracts": "Contratos",
  "nav.rentals.charges": "Cobros",
  "nav.rentals.settlements": "Liquidaciones",
  "nav.rentals.renewals": "Renovaciones",
  "nav.communications": "Comunicaciones",
  "nav.communications.whatsapp": "WhatsApp",
  "nav.communications.email": "Email",
  "nav.communications.inbox": "Consultas",
  "nav.communications.chat": "Mensajes internos",
  "nav.communications.templates": "Plantillas",
  "nav.agenda": "Agenda",
  "nav.documents": "Documentos",
  "nav.finance": "Finanzas",
  "nav.finance.commissions": "Comisiones",
  "nav.finance.invoicing": "Facturación",
  "nav.finance.reports": "Reportes",
  "nav.performance": "Rendimiento",
  "nav.performance.goals": "Métricas del parte",
  "nav.performance.career": "Mi carrera",
  "nav.performance.ranking": "Competencia",
  "nav.performance.closingMap": "Mapa de cierre",
  "nav.admin": "Administración",
  "nav.admin.users": "Usuarios",
  "nav.admin.teams": "Equipos",
  "nav.admin.branches": "Sucursales",
  "nav.admin.roles": "Roles y permisos",
  "nav.admin.integrations": "Integraciones",
  "nav.admin.automations": "Automatizaciones",
  "nav.admin.audit": "Auditoría",
  "nav.admin.settings": "Configuración",
} as const;

export type MessageKey = keyof typeof es;

const dictionaries: Record<string, Record<MessageKey, string>> = { es };

export function t(key: MessageKey, locale = "es"): string {
  return dictionaries[locale]?.[key] ?? es[key];
}
