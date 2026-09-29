import type { PermissionCode } from "@crm/shared/rbac";
import type { MessageKey } from "./i18n";

/**
 * Navegación completa del CRM. Cada entrada declara el permiso que la habilita y la fase del
 * roadmap en la que se construye. Las que aún no existen llevan a una página que lo dice
 * con claridad: ningún botón aparenta funcionar sin backend.
 */
export type IconName =
  | "dashboard"
  | "users"
  | "building"
  | "briefcase"
  | "key"
  | "message"
  | "calendar"
  | "file"
  | "wallet"
  | "settings"
  | "chart";

export interface NavItem {
  href: string;
  label: MessageKey;
  permission: PermissionCode;
  /** Fase del roadmap en que se implementa. `null` = ya disponible. */
  plannedPhase: number | null;
  description?: string;
}

export interface NavSection {
  key: string;
  label: MessageKey;
  icon: IconName;
  href?: string;
  permission?: PermissionCode;
  plannedPhase?: number | null;
  items?: NavItem[];
}

export const NAVIGATION: NavSection[] = [
  {
    key: "dashboard",
    label: "nav.dashboard",
    icon: "dashboard",
    href: "/dashboard",
    permission: "dashboard.read",
    plannedPhase: null,
  },
  {
    key: "crm",
    label: "nav.crm",
    icon: "users",
    items: [
      {
        href: "/crm/leads",
        label: "nav.crm.leads",
        permission: "lead.read",
        plannedPhase: null,
        description: "Consultas entrantes, embudo y seguimiento.",
      },
      {
        href: "/crm/clients",
        label: "nav.crm.clients",
        permission: "lead.read",
        plannedPhase: null,
        description: "Ficha 360° de compradores e inquilinos.",
      },
      {
        href: "/crm/owners",
        label: "nav.crm.owners",
        permission: "owner.read",
        plannedPhase: null,
        description: "Propietarios, copropiedad y datos restringidos.",
      },
      {
        href: "/crm/contacts",
        label: "nav.crm.contacts",
        permission: "contact.read",
        plannedPhase: null,
        description: "Todas las personas y empresas, con detección de duplicados.",
      },
    ],
  },
  {
    key: "properties",
    label: "nav.properties",
    icon: "building",
    items: [
      {
        href: "/properties",
        label: "nav.properties.list",
        permission: "property.read",
        plannedPhase: null,
        description: "Inventario con código PROP, multimedia e historial de precios.",
      },
      {
        href: "/properties/acquisitions",
        label: "nav.properties.acquisitions",
        permission: "acquisition.read",
        plannedPhase: null,
        description: "Pipeline de captación y exclusividades.",
      },
      {
        href: "/properties/valuations",
        label: "nav.properties.valuations",
        permission: "valuation.read",
        plannedPhase: null,
        description: "Tasaciones con comparables.",
      },
      {
        href: "/properties/publications",
        label: "nav.properties.publications",
        permission: "publication.read",
        plannedPhase: 11,
        description: "Publicaciones en portales y su rendimiento.",
      },
    ],
  },
  {
    key: "commercial",
    label: "nav.commercial",
    icon: "briefcase",
    items: [
      {
        href: "/commercial/matching",
        label: "nav.commercial.matching",
        permission: "lead.read",
        plannedPhase: null,
        description: "Compatibilidad entre búsquedas y propiedades.",
      },
      {
        href: "/commercial/visits",
        label: "nav.commercial.visits",
        permission: "visit.read",
        plannedPhase: null,
        description: "Calendario de visitas y feedback.",
      },
      {
        href: "/commercial/offers",
        label: "nav.commercial.offers",
        permission: "offer.read",
        plannedPhase: 6,
        description: "Ofertas y contraofertas con historial inmutable.",
      },
      {
        href: "/commercial/reservations",
        label: "nav.commercial.reservations",
        permission: "reservation.read",
        plannedPhase: 6,
        description: "Reservas que bloquean la disponibilidad.",
      },
      {
        href: "/commercial/deals",
        label: "nav.commercial.deals",
        permission: "deal.read",
        plannedPhase: null,
        description: "Pipeline de operaciones de venta y alquiler.",
      },
    ],
  },
  {
    key: "rentals",
    label: "nav.rentals",
    icon: "key",
    items: [
      {
        href: "/rentals/guarantees",
        label: "nav.rentals.guarantees",
        permission: "guarantee.read",
        plannedPhase: 8,
        description: "Garantías configurables: CGN, MVOT, ANDA, aseguradoras, depósito.",
      },
      {
        href: "/rentals/contracts",
        label: "nav.rentals.contracts",
        permission: "contract.read",
        plannedPhase: 7,
        description: "Contratos, partes y alertas de vencimiento.",
      },
      {
        href: "/rentals/charges",
        label: "nav.rentals.charges",
        permission: "rent.read",
        plannedPhase: 9,
        description: "Cobros mensuales, pagos parciales y morosidad.",
      },
      {
        href: "/rentals/settlements",
        label: "nav.rentals.settlements",
        permission: "settlement.read",
        plannedPhase: 9,
        description: "Liquidaciones a propietarios.",
      },
      {
        href: "/rentals/renewals",
        label: "nav.rentals.renewals",
        permission: "contract.read",
        plannedPhase: 7,
        description: "Renovaciones y rescisiones.",
      },
    ],
  },
  {
    key: "communications",
    label: "nav.communications",
    icon: "message",
    items: [
      {
        href: "/communications/whatsapp",
        label: "nav.communications.whatsapp",
        permission: "communication.read",
        plannedPhase: 10,
        description: "Requiere WhatsApp Business Platform configurado.",
      },
      {
        href: "/communications/email",
        label: "nav.communications.email",
        permission: "communication.read",
        plannedPhase: 10,
        description: "Requiere un proveedor de email configurado.",
      },
      {
        href: "/communications/inbox",
        label: "nav.communications.inbox",
        permission: "communication.read",
        plannedPhase: 10,
        description: "Consultas que el asistente virtual no resolvió y derivó a una persona.",
      },
      {
        href: "/communications/chat",
        label: "nav.communications.chat",
        permission: "communication.read",
        plannedPhase: 10,
        description: "Mensajes internos del equipo: directos y grupos.",
      },
      {
        href: "/communications/templates",
        label: "nav.communications.templates",
        permission: "template.manage",
        plannedPhase: 10,
        description: "Plantillas por canal con variables.",
      },
    ],
  },
  {
    key: "agenda",
    label: "nav.agenda",
    icon: "calendar",
    href: "/agenda",
    permission: "calendar.read",
    plannedPhase: null,
  },
  {
    key: "documents",
    label: "nav.documents",
    icon: "file",
    href: "/documents",
    permission: "document.read",
    plannedPhase: null,
  },
  {
    key: "finance",
    label: "nav.finance",
    icon: "wallet",
    items: [
      {
        href: "/finance/commissions",
        label: "nav.finance.commissions",
        permission: "commission.read",
        plannedPhase: null,
        description: "Comisiones y reparto entre participantes.",
      },
      {
        href: "/finance/invoicing",
        label: "nav.finance.invoicing",
        permission: "invoice.read",
        plannedPhase: 9,
        description: "Requiere un proveedor de facturación electrónica (CFE).",
      },
      {
        href: "/finance/reports",
        label: "nav.finance.reports",
        permission: "report.read",
        plannedPhase: 13,
        description: "Conversión, tiempos de venta y rendimiento por agente.",
      },
    ],
  },
  {
    key: "performance",
    label: "nav.performance",
    icon: "chart",
    items: [
      {
        href: "/performance/goals",
        label: "nav.performance.goals",
        permission: "dashboard.read",
        plannedPhase: null,
        description:
          "Actividad semanal contra la meta individual: presentaciones, captaciones, reservas y boletos.",
      },
      {
        href: "/performance/career",
        label: "nav.performance.career",
        permission: "commission.read",
        plannedPhase: null,
        description: "Escalones de comisión según facturación acumulada.",
      },
      {
        href: "/performance/ranking",
        label: "nav.performance.ranking",
        permission: "dashboard.read",
        plannedPhase: null,
        description: "Ranking por puntos de agentes y sucursales por temporada.",
      },
      {
        href: "/performance/closing-map",
        label: "nav.performance.closingMap",
        permission: "property.read",
        plannedPhase: null,
        description: "Mapa de operaciones vendidas, alquiladas y reservadas.",
      },
    ],
  },
  {
    key: "admin",
    label: "nav.admin",
    icon: "settings",
    items: [
      { href: "/admin/users", label: "nav.admin.users", permission: "users.read", plannedPhase: null },
      { href: "/admin/teams", label: "nav.admin.teams", permission: "users.read", plannedPhase: null },
      { href: "/admin/branches", label: "nav.admin.branches", permission: "users.read", plannedPhase: null },
      { href: "/admin/roles", label: "nav.admin.roles", permission: "roles.manage", plannedPhase: null },
      {
        href: "/admin/integrations",
        label: "nav.admin.integrations",
        permission: "integrations.manage",
        plannedPhase: 11,
        description: "Portales, tipo de cambio, almacenamiento y facturación.",
      },
      {
        href: "/admin/automations",
        label: "nav.admin.automations",
        permission: "automation.manage",
        plannedPhase: 12,
        description: "Reglas trigger → condiciones → acciones con historial.",
      },
      { href: "/admin/audit", label: "nav.admin.audit", permission: "audit.read", plannedPhase: null },
      {
        href: "/admin/settings",
        label: "nav.admin.settings",
        permission: "settings.manage",
        plannedPhase: null,
      },
    ],
  },
];

export function findNavItem(pathname: string): { item: NavItem; section: NavSection } | null {
  for (const section of NAVIGATION) {
    if (section.href === pathname && section.permission) {
      return {
        section,
        item: {
          href: section.href,
          label: section.label,
          permission: section.permission,
          plannedPhase: section.plannedPhase ?? null,
        },
      };
    }
    for (const item of section.items ?? []) if (item.href === pathname) return { item, section };
  }
  return null;
}
