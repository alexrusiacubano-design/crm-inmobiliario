import { and, count, eq } from "drizzle-orm";
import { contact, membership, organization, user, type Db } from "@crm/db";
import { DEMO_ORG_SLUG, demoEmail } from "@crm/db/seed";
import type { LeadLostReason, LeadOperation, LeadSource, LeadStatus, PropertyType } from "@crm/shared";
import { loadContext, type RequestContext } from "../context";
import { createContact, updateContact } from "./contacts";
import { changeLeadStatus, createLead } from "./leads";
import { upsertOwnerProfile } from "./owners";
import { logInteraction } from "./timeline";

/**
 * Datos DEMO del CRM, cargados a través de los servicios reales (así el índice de búsqueda,
 * el timeline y la auditoría quedan consistentes). Todos los contactos llevan la etiqueta
 * "DEMO"; teléfonos y emails son ficticios (dominio reservado example.com).
 */

interface DemoLead {
  agent: string;
  first: string;
  last: string;
  phone: string;
  email?: string;
  ci?: string;
  operation: LeadOperation;
  source: LeadSource;
  status: LeadStatus;
  lostReason?: LeadLostReason;
  types: PropertyType[];
  zones: string[];
  currency: "USD" | "UYU";
  min?: string;
  max: string;
  bedrooms?: number;
  pets?: boolean;
  garages?: number;
  note: string;
}

const LEADS: DemoLead[] = [
  {
    agent: "agente",
    first: "Juan",
    last: "Pérez",
    phone: "099 123 456",
    email: "juan.perez@example.com",
    ci: "1.234.567-2",
    operation: "buy",
    source: "portal",
    status: "visit",
    types: ["apartment"],
    zones: ["Pocitos", "Punta Carretas"],
    currency: "USD",
    min: "180.000",
    max: "230.000",
    bedrooms: 2,
    garages: 1,
    note: "Busca 2 dormitorios con garaje cerca de la rambla.",
  },
  {
    agent: "agente",
    first: "María",
    last: "Silva",
    phone: "098 765 432",
    email: "maria.silva@example.com",
    operation: "rent",
    source: "whatsapp",
    status: "new",
    types: ["apartment"],
    zones: ["Cordón", "Parque Rodó"],
    currency: "UYU",
    max: "32.000",
    bedrooms: 1,
    pets: true,
    note: "Tiene un perro chico. Garantía ANDA.",
  },
  {
    agent: "agente",
    first: "Lucas",
    last: "Gómez",
    phone: "091 222 333",
    operation: "buy",
    source: "referral",
    status: "offer",
    types: ["house"],
    zones: ["Carrasco", "Malvín"],
    currency: "USD",
    min: "350.000",
    max: "450.000",
    bedrooms: 3,
    garages: 2,
    note: "Referido de un cliente anterior.",
  },
  {
    agent: "agente",
    first: "Sofía",
    last: "Rodríguez",
    phone: "094 555 111",
    email: "sofia.r@example.com",
    operation: "rent",
    source: "portal",
    status: "contacted",
    types: ["apartment"],
    zones: ["Pocitos"],
    currency: "UYU",
    max: "40.000",
    bedrooms: 2,
    note: "Mudanza para marzo.",
  },
  {
    agent: "agente",
    first: "Diego",
    last: "Fernández",
    phone: "092 333 444",
    operation: "buy",
    source: "sign",
    status: "lost",
    lostReason: "bought_elsewhere",
    types: ["apartment"],
    zones: ["Buceo"],
    currency: "USD",
    max: "160.000",
    bedrooms: 1,
    note: "Vio el cartel en Buceo.",
  },
  {
    agent: "agente",
    first: "Valeria",
    last: "Martínez",
    phone: "095 666 777",
    operation: "rent",
    source: "website",
    status: "qualified",
    types: ["apartment", "ph"],
    zones: ["Parque Rodó", "Cordón"],
    currency: "UYU",
    max: "28.000",
    bedrooms: 1,
    note: "Estudiante de posgrado.",
  },
  {
    agent: "agente2",
    first: "Martín",
    last: "López",
    phone: "099 888 999",
    email: "martin.lopez@example.com",
    operation: "temporary_rent",
    source: "portal",
    status: "reservation",
    types: ["apartment"],
    zones: ["Punta del Este"],
    currency: "USD",
    max: "4.500",
    bedrooms: 2,
    note: "Temporada enero, primera quincena.",
  },
  {
    agent: "agente2",
    first: "Camila",
    last: "Álvarez",
    phone: "093 111 000",
    operation: "buy",
    source: "social",
    status: "new",
    types: ["house"],
    zones: ["Punta del Este", "Maldonado"],
    currency: "USD",
    min: "250.000",
    max: "380.000",
    bedrooms: 3,
    pets: true,
    note: "Consulta por Instagram.",
  },
  {
    agent: "agente2",
    first: "Andrés",
    last: "Castro",
    phone: "097 444 222",
    operation: "buy",
    source: "walk_in",
    status: "visit",
    types: ["land"],
    zones: ["Piriápolis"],
    currency: "USD",
    max: "90.000",
    note: "Busca terreno para construir.",
  },
  {
    agent: "agente2",
    first: "Natalia",
    last: "Suárez",
    phone: "096 777 333",
    email: "natalia.s@example.com",
    operation: "rent",
    source: "phone",
    status: "contacted",
    types: ["house"],
    zones: ["Maldonado"],
    currency: "UYU",
    max: "45.000",
    bedrooms: 3,
    pets: true,
    note: "Familia con dos hijos.",
  },
  {
    agent: "supervisor",
    first: "Federico",
    last: "Ramos",
    phone: "098 222 555",
    operation: "buy",
    source: "portal",
    status: "qualified",
    types: ["apartment"],
    zones: ["Punta Carretas"],
    currency: "USD",
    min: "280.000",
    max: "340.000",
    bedrooms: 3,
    garages: 1,
    note: "Inversor, compra para alquilar.",
  },
  {
    agent: "supervisor",
    first: "Carolina",
    last: "Méndez",
    phone: "091 999 111",
    operation: "rent",
    source: "referral",
    status: "new",
    types: ["office"],
    zones: ["Centro", "Cordón"],
    currency: "UYU",
    max: "35.000",
    note: "Oficina para estudio contable.",
  },
  {
    agent: "gerente",
    first: "Pablo",
    last: "Olivera",
    phone: "094 123 987",
    operation: "buy",
    source: "website",
    status: "offer",
    types: ["house"],
    zones: ["Carrasco"],
    currency: "USD",
    min: "500.000",
    max: "700.000",
    bedrooms: 4,
    garages: 2,
    note: "Relocalización desde Buenos Aires.",
  },
  {
    agent: "gerente",
    first: "Lucía",
    last: "Pereira",
    phone: "092 555 888",
    operation: "rent",
    source: "portal",
    status: "contacted",
    types: ["apartment"],
    zones: ["Carrasco", "Malvín"],
    currency: "USD",
    max: "1.800",
    bedrooms: 2,
    pets: true,
    note: "Contrato corporativo.",
  },
  {
    agent: "agente",
    first: "Gabriel",
    last: "Núñez",
    phone: "099 321 654",
    operation: "buy",
    source: "portal",
    status: "new",
    types: ["apartment"],
    zones: ["Ciudad de la Costa", "Atlántida"],
    currency: "USD",
    max: "150.000",
    bedrooms: 2,
    note: "Primera vivienda.",
  },
];

const OWNERS = [
  {
    agent: "administracion",
    first: "Laura",
    last: "Gómez",
    phone: "099 400 100",
    email: "laura.gomez@example.com",
    bank: "BROU",
    account: "001234567890",
    currency: "UYU" as const,
    note: "Poder notarial a nombre del hijo para firmar contratos.",
  },
  {
    agent: "administracion",
    first: "Ricardo",
    last: "Sosa",
    phone: "098 400 200",
    bank: "Itaú",
    account: "7788990011",
    currency: "USD" as const,
    note: null,
  },
  {
    agent: "agente2",
    first: "Inversiones del Este",
    last: "",
    company: true,
    phone: "4222 1234",
    email: "admin@inversioneseste.example.com",
    bank: "Santander",
    account: "5500112233",
    currency: "USD" as const,
    note: "Sociedad con tres apartamentos en la Península.",
  },
  {
    agent: "gerente",
    first: "Beatriz",
    last: "Ferreira",
    phone: "2600 5050",
    bank: null,
    account: null,
    currency: null,
    note: null,
  },
];

const STATUS_PATH: Record<LeadStatus, LeadStatus[]> = {
  new: [],
  contacted: ["contacted"],
  qualified: ["contacted", "qualified"],
  visit: ["contacted", "qualified", "visit"],
  offer: ["contacted", "qualified", "visit", "offer"],
  reservation: ["contacted", "qualified", "visit", "offer", "reservation"],
  won: ["contacted", "qualified", "visit", "offer", "reservation", "won"],
  lost: ["contacted", "lost"],
};

async function ctxForDemo(db: Db, organizationId: string, key: string): Promise<RequestContext> {
  const [u] = await db
    .select({ id: user.id })
    .from(user)
    .innerJoin(membership, eq(membership.userId, user.id))
    .where(and(eq(user.email, demoEmail(key)), eq(membership.organizationId, organizationId)));
  if (!u) throw new Error(`Usuario DEMO ${key} no encontrado`);
  return loadContext(db, { userId: u.id, organizationId, meta: { requestId: "seed-demo" } });
}

export async function seedDemoCrm(db: Db): Promise<{ skipped: boolean; contacts: number; leads: number }> {
  const [org] = await db.select().from(organization).where(eq(organization.slug, DEMO_ORG_SLUG));
  if (!org?.isDemo) throw new Error("No existe la organización DEMO: corré primero el seed base");
  const [existing] = await db.select({ n: count() }).from(contact).where(eq(contact.organizationId, org.id));
  if ((existing?.n ?? 0) > 0) return { skipped: true, contacts: 0, leads: 0 };

  const admin = await ctxForDemo(db, org.id, "superadmin");
  const geo = await import("./timeline").then((m) => m.listGeo(db));
  const zoneIds = (names: string[]) => {
    const localityIds: number[] = [];
    const neighborhoodIds: number[] = [];
    for (const name of names) {
      const n = geo.neighborhoods.find((x) => x.name === name);
      const l = geo.localities.find((x) => x.name === name);
      if (n) neighborhoodIds.push(n.id);
      else if (l) localityIds.push(l.id);
    }
    return { localityIds, neighborhoodIds };
  };

  let leads = 0;
  for (const d of LEADS) {
    const agent = await ctxForDemo(db, org.id, d.agent);
    const channels = [
      { type: "phone" as const, value: d.phone },
      ...(d.email ? [{ type: "email" as const, value: d.email }] : []),
    ];
    const { lead: l } = await createLead(db, admin, {
      operation: d.operation,
      source: d.source,
      assignedUserId: agent.userId,
      notes: d.note,
      contact: {
        firstName: d.first,
        lastName: d.last,
        ...(d.ci ? { documentType: "ci", documentNumber: d.ci } : {}),
        nationality: "Uruguaya",
        channels,
        tags: ["DEMO"],
        assignedUserId: agent.userId,
      },
      search: {
        operation: d.operation,
        propertyTypes: d.types,
        ...zoneIds(d.zones),
        currency: d.currency,
        priceMin: d.min ?? null,
        priceMax: d.max,
        bedroomsMin: d.bedrooms ?? null,
        garagesMin: d.garages ?? null,
        pets: d.pets ?? false,
      },
    });
    leads += 1;
    for (const step of STATUS_PATH[d.status]) {
      if (step === "contacted") {
        await logInteraction(db, agent, {
          leadId: l.id,
          type: "call",
          direction: "outbound",
          body: "Primer contacto: se confirmó lo que busca.",
        });
      } else {
        await changeLeadStatus(db, agent, {
          leadId: l.id,
          status: step,
          ...(step === "lost" ? { lostReason: d.lostReason ?? "other" } : {}),
        });
      }
    }
    if (d.status === "visit" || d.status === "offer") {
      await logInteraction(db, agent, {
        leadId: l.id,
        type: "whatsapp",
        direction: "inbound",
        body: "Consulta horarios para visitar.",
      });
    }
  }

  for (const o of OWNERS) {
    const agent = await ctxForDemo(db, org.id, o.agent);
    const { contact: c } = await createContact(db, admin, {
      kind: o.company ? "company" : "person",
      firstName: o.company ? null : o.first,
      lastName: o.company ? null : o.last,
      companyName: o.company ? o.first : null,
      channels: [{ type: "phone", value: o.phone }, ...(o.email ? [{ type: "email", value: o.email }] : [])],
      tags: ["DEMO", "Propietario"],
      assignedUserId: agent.userId,
    });
    const canEncrypt = !!process.env.FIELD_ENCRYPTION_KEY;
    await upsertOwnerProfile(db, admin, {
      contactId: c.id,
      authorizationNotes: o.note,
      ...(o.bank && canEncrypt
        ? {
            bankName: o.bank,
            accountHolder: `${o.first} ${o.last}`.trim(),
            accountNumber: o.account,
            accountCurrency: o.currency,
          }
        : {}),
    });
  }

  // Dos posibles duplicados para revisar en Contactos → Duplicados.
  const agente = await ctxForDemo(db, org.id, "agente");
  await createContact(db, agente, {
    firstName: "Juan Carlos",
    lastName: "Perez",
    channels: [{ type: "whatsapp", value: "+598 99 123 456" }],
    tags: ["DEMO"],
  });
  const { contact: dup } = await createContact(db, admin, {
    firstName: "Maria",
    lastName: "Silva",
    channels: [{ type: "email", value: "MARIA.SILVA@example.com" }],
    tags: ["DEMO"],
    assignedUserId: agente.userId,
  });
  await updateContact(db, admin, {
    id: dup.id,
    firstName: "Maria",
    lastName: "Silva",
    channels: [{ type: "email", value: "maria.silva@example.com" }],
    tags: ["DEMO"],
    notes: "Cargada desde el formulario web; parece la misma María Silva del lead por WhatsApp.",
  });

  const [total] = await db.select({ n: count() }).from(contact).where(eq(contact.organizationId, org.id));
  return { skipped: false, contacts: total?.n ?? 0, leads };
}
