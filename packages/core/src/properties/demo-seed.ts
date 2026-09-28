import { and, count, eq, sql } from "drizzle-orm";
import sharp from "sharp";
import { acquisition, contact, membership, organization, property, user, type Db } from "@crm/db";
import { DEMO_ORG_SLUG, demoEmail } from "@crm/db/seed";
import type { PropertyFeature, PropertyType } from "@crm/shared";
import type { PropertyOperation, PropertyStatus } from "@crm/shared/property";
import { loadContext, type RequestContext } from "../context";
import { listGeo } from "../crm/timeline";
import { uploadDocument } from "../documents/documents";
import type { StorageProvider } from "../storage/provider";
import {
  changeAcquisitionStage,
  createAcquisition,
  createValuation,
  updateAcquisition,
} from "./acquisitions";
import { addPropertyImage, addPropertyVideo } from "./media";
import { changePropertyStatus, createProperty, setPrices, setPropertyOwners } from "./properties";

/**
 * Propiedades DEMO, cargadas con los servicios reales (código PROP, historial de precios,
 * auditoría, índice de búsqueda). Las fotos son ilustraciones generadas con la leyenda
 * "DEMO": no hay imágenes de inmuebles reales.
 */

type Geo = Awaited<ReturnType<typeof listGeo>>;

interface DemoProperty {
  key: string;
  agent: string;
  type: PropertyType;
  operations: PropertyOperation[];
  title: string;
  description: string;
  locality: string;
  neighborhood?: string;
  address: string;
  bedrooms?: number;
  bathrooms?: number;
  garages?: number;
  builtArea?: string;
  totalArea?: string;
  features?: PropertyFeature[];
  pets?: boolean;
  commission: string;
  prices: {
    operation: PropertyOperation;
    currency: "USD" | "UYU";
    list: string;
    ownerAsking?: string;
    minimum?: string;
  }[];
  /** Rebajas posteriores (quedan en el historial). */
  reductions?: string[];
  owners: { name: string; share: string }[];
  photos: number;
  status: PropertyStatus;
  expenses?: {
    kind: "common_expenses" | "property_tax" | "primary_tax";
    amount: string;
    currency: "UYU" | "USD";
    period: "monthly" | "bimonthly" | "annual";
  }[];
  video?: string;
}

/** Coordenadas aproximadas de cada barrio para el mapa de cierres (datos DEMO). */
const DEMO_COORDS: Record<string, { latitude: string; longitude: string }> = {
  pocitos: { latitude: "-34.911500", longitude: "-56.150700" },
  cordon: { latitude: "-34.902900", longitude: "-56.178900" },
  carrasco: { latitude: "-34.887000", longitude: "-56.056000" },
  peninsula: { latitude: "-34.963000", longitude: "-54.946000" },
  "parque-rodo": { latitude: "-34.912500", longitude: "-56.167800" },
  "local-centro": { latitude: "-34.905800", longitude: "-56.191200" },
  "punta-carretas": { latitude: "-34.923200", longitude: "-56.158900" },
  malvin: { latitude: "-34.893000", longitude: "-56.100000" },
};

/** Completa coordenadas DEMO en bases sembradas antes de que existiera el mapa. */
export async function backfillDemoCoordinates(db: Db): Promise<number> {
  const [org] = await db.select().from(organization).where(eq(organization.slug, DEMO_ORG_SLUG));
  if (!org?.isDemo) return 0;
  let n = 0;
  for (const d of PROPERTIES) {
    const c = DEMO_COORDS[d.key];
    if (!c) continue;
    const updated = await db
      .update(property)
      .set(c)
      .where(
        and(
          eq(property.organizationId, org.id),
          eq(property.title, d.title),
          sql`${property.latitude} is null`,
        ),
      )
      .returning({ id: property.id });
    n += updated.length;
  }
  return n;
}

const PROPERTIES: DemoProperty[] = [
  {
    key: "pocitos",
    agent: "agente",
    type: "apartment",
    operations: ["sale"],
    title: "Apartamento 2 dormitorios con garaje en Pocitos",
    description:
      "Luminoso apartamento al frente a dos cuadras de la rambla. Living comedor con balcón, cocina integrada, dos dormitorios con placares y baño completo. Garaje y baulera. Edificio con portería.",
    locality: "Montevideo",
    neighborhood: "Pocitos",
    address: "Av. Brasil 2800",
    bedrooms: 2,
    bathrooms: 1,
    garages: 1,
    builtArea: "72",
    features: ["balcony", "elevator", "doorman"],
    commission: "3",
    prices: [
      { operation: "sale", currency: "USD", list: "229.000", ownerAsking: "235.000", minimum: "215.000" },
    ],
    reductions: ["219.000"],
    owners: [{ name: "Laura Gómez", share: "100" }],
    photos: 5,
    status: "published",
    expenses: [{ kind: "common_expenses", amount: "7.800", currency: "UYU", period: "monthly" }],
  },
  {
    key: "cordon",
    agent: "agente",
    type: "apartment",
    operations: ["rent"],
    title: "Apartamento 1 dormitorio en Cordón, cerca de facultades",
    description:
      "Apartamento interior muy tranquilo, a metros de 18 de Julio y de las facultades. Dormitorio con placard, baño reciclado y cocina independiente. Ideal estudiantes.",
    locality: "Montevideo",
    neighborhood: "Cordón",
    address: "Guayabos 1500",
    bedrooms: 1,
    bathrooms: 1,
    builtArea: "40",
    pets: true,
    commission: "5",
    prices: [{ operation: "rent", currency: "UYU", list: "24.000", ownerAsking: "25.000" }],
    owners: [{ name: "Ricardo Sosa", share: "100" }],
    photos: 3,
    status: "published",
    expenses: [{ kind: "common_expenses", amount: "4.200", currency: "UYU", period: "monthly" }],
  },
  {
    key: "carrasco",
    agent: "gerente",
    type: "house",
    operations: ["sale"],
    title: "Casa en Carrasco con jardín y piscina",
    description:
      "Casa de dos plantas en zona residencial. Cuatro dormitorios (dos en suite), living con estufa a leña, cocina amplia, jardín con piscina y parrillero. Garaje para dos autos.",
    locality: "Montevideo",
    neighborhood: "Carrasco",
    address: "Divina Comedia 1700",
    bedrooms: 4,
    bathrooms: 3,
    garages: 2,
    builtArea: "260",
    totalArea: "600",
    features: ["pool", "garden", "barbecue", "heating"],
    commission: "3",
    prices: [
      { operation: "sale", currency: "USD", list: "480.000", ownerAsking: "500.000", minimum: "450.000" },
    ],
    owners: [
      { name: "Beatriz Ferreira", share: "50" },
      { name: "Laura Gómez", share: "50" },
    ],
    photos: 4,
    status: "available",
  },
  {
    key: "peninsula",
    agent: "agente2",
    type: "apartment",
    operations: ["sale", "temporary_rent"],
    title: "Apartamento frente al mar en la Península",
    description:
      "Tres dormitorios con vista al puerto. Terraza, parrillero propio y cochera. Se vende o se alquila por temporada (enero y febrero).",
    locality: "Punta del Este",
    neighborhood: "Península",
    address: "Calle 20 y Rambla",
    bedrooms: 3,
    bathrooms: 2,
    garages: 1,
    builtArea: "110",
    features: ["terrace", "barbecue", "elevator"],
    commission: "4",
    prices: [
      { operation: "sale", currency: "USD", list: "395.000", ownerAsking: "410.000" },
      { operation: "temporary_rent", currency: "USD", list: "9.500" },
    ],
    owners: [{ name: "Inversiones del Este", share: "100" }],
    photos: 4,
    status: "published",
    video: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  },
  {
    key: "parque-rodo",
    agent: "agente",
    type: "apartment",
    operations: ["rent"],
    title: "Monoambiente en Parque Rodó",
    description: "Monoambiente reciclado frente al parque.",
    locality: "Montevideo",
    neighborhood: "Parque Rodó",
    address: "Bulevar España 2100",
    bedrooms: 0,
    bathrooms: 1,
    builtArea: "32",
    commission: "5",
    prices: [],
    owners: [],
    photos: 1,
    status: "draft",
  },
  {
    key: "local-centro",
    agent: "supervisor",
    type: "commercial",
    operations: ["rent"],
    title: "Local comercial sobre 18 de Julio",
    description:
      "Local de 90 m² con vidriera sobre avenida principal, depósito y baño. Excelente flujo peatonal, apto para comercio minorista o gastronomía.",
    locality: "Montevideo",
    neighborhood: "Centro",
    address: "Av. 18 de Julio 1000",
    bathrooms: 1,
    builtArea: "90",
    commission: "5",
    prices: [{ operation: "rent", currency: "UYU", list: "45.000" }],
    owners: [{ name: "Ricardo Sosa", share: "100" }],
    photos: 3,
    status: "reserved",
  },
  {
    key: "punta-carretas",
    agent: "agente",
    type: "apartment",
    operations: ["sale"],
    title: "Apartamento 3 dormitorios en Punta Carretas",
    description:
      "Planta completa con palier privado, tres dormitorios (uno en suite), living en L con terraza, cocina con comedor diario, dependencia de servicio y dos cocheras.",
    locality: "Montevideo",
    neighborhood: "Punta Carretas",
    address: "José Ellauri 900",
    bedrooms: 3,
    bathrooms: 3,
    garages: 2,
    builtArea: "145",
    features: ["terrace", "elevator", "doorman"],
    commission: "3",
    prices: [
      { operation: "sale", currency: "USD", list: "340.000", ownerAsking: "340.000", minimum: "310.000" },
    ],
    reductions: ["329.000", "318.000"],
    owners: [{ name: "Laura Gómez", share: "100" }],
    photos: 4,
    status: "published",
  },
];

const PALETTES: [string, string][] = [
  ["#0f766e", "#5eead4"],
  ["#1e3a8a", "#93c5fd"],
  ["#7c2d12", "#fdba74"],
  ["#3f6212", "#bef264"],
  ["#581c87", "#d8b4fe"],
];

/** Ilustración DEMO (no es una foto real): fondo, silueta de edificio y leyenda. */
export async function demoImage(label: string, variant: number): Promise<Buffer> {
  const [a, b] = PALETTES[variant % PALETTES.length] ?? PALETTES[0] ?? ["#0f766e", "#5eead4"];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1067" viewBox="0 0 1600 1067">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
  <rect width="1600" height="1067" fill="url(#g)"/>
  <g fill="#ffffff" fill-opacity="0.85">
    <rect x="${520 + (variant % 3) * 40}" y="380" width="560" height="520" rx="8"/>
    <polygon points="${480 + (variant % 3) * 40},400 ${800 + (variant % 3) * 40},180 ${1120 + (variant % 3) * 40},400"/>
  </g>
  <g fill="${a}" fill-opacity="0.9">
    <rect x="${600 + (variant % 3) * 40}" y="480" width="120" height="120"/>
    <rect x="${880 + (variant % 3) * 40}" y="480" width="120" height="120"/>
    <rect x="${740 + (variant % 3) * 40}" y="700" width="120" height="200"/>
  </g>
  <rect x="0" y="960" width="1600" height="107" fill="#000" fill-opacity="0.35"/>
  <text x="48" y="1030" font-family="sans-serif" font-size="52" font-weight="700" fill="#fff">DEMO · ${label}</text>
</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
}

/** PDF mínimo válido con una línea de texto, para documentos DEMO. */
export function demoPdf(text: string): Buffer {
  const safe = text.replace(/[()\\]/g, "").replace(/[^\x20-\x7e]/g, "?");
  const stream = `BT /F1 18 Tf 72 720 Td (DEMO - ${safe}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

export async function ctxForDemo(db: Db, organizationId: string, key: string): Promise<RequestContext> {
  const [u] = await db
    .select({ id: user.id })
    .from(user)
    .innerJoin(membership, eq(membership.userId, user.id))
    .where(and(eq(user.email, demoEmail(key)), eq(membership.organizationId, organizationId)));
  if (!u) throw new Error(`Usuario DEMO ${key} no encontrado`);
  return loadContext(db, { userId: u.id, organizationId, meta: { requestId: "seed-demo" } });
}

function zone(geo: Geo, localityName: string, neighborhoodName?: string) {
  const loc = geo.localities.find((l) => l.name === localityName);
  if (!loc) throw new Error(`Localidad DEMO no encontrada: ${localityName}`);
  const nb = neighborhoodName
    ? geo.neighborhoods.find((n) => n.localityId === loc.id && n.name === neighborhoodName)
    : undefined;
  return { localityId: loc.id, neighborhoodId: nb?.id ?? null };
}

const isoDay = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

export async function seedDemoProperties(
  db: Db,
  storage: StorageProvider,
): Promise<{ skipped: boolean; properties: number; acquisitions: number }> {
  const [org] = await db.select().from(organization).where(eq(organization.slug, DEMO_ORG_SLUG));
  if (!org?.isDemo) throw new Error("No existe la organización DEMO: corré primero el seed base");
  const [existing] = await db
    .select({ n: count() })
    .from(property)
    .where(eq(property.organizationId, org.id));
  if ((existing?.n ?? 0) > 0) return { skipped: true, properties: 0, acquisitions: 0 };

  const geo = await listGeo(db);
  const admin = await ctxForDemo(db, org.id, "superadmin");
  const ownerId = async (name: string) => {
    const [c] = await db
      .select({ id: contact.id })
      .from(contact)
      .where(and(eq(contact.organizationId, org.id), eq(contact.displayName, name)));
    if (!c) throw new Error(`Propietario DEMO no encontrado: ${name} (corré primero el seed del CRM)`);
    return c.id;
  };

  const ids = new Map<string, string>();
  let photoVariant = 0;
  for (const d of PROPERTIES) {
    const agent = await ctxForDemo(db, org.id, d.agent);
    const p = await createProperty(db, agent, {
      type: d.type,
      operations: d.operations,
      title: d.title,
      description: d.description,
      ...zone(geo, d.locality, d.neighborhood),
      address: d.address,
      ...(DEMO_COORDS[d.key] ?? {}),
      bedrooms: d.bedrooms ?? null,
      bathrooms: d.bathrooms ?? null,
      garages: d.garages ?? null,
      builtArea: d.builtArea ?? null,
      totalArea: d.totalArea ?? null,
      features: d.features ?? [],
      petsAllowed: d.pets ?? false,
      commissionPercent: d.commission,
      internalNotes: "Propiedad DEMO: datos ficticios para capacitación.",
      expenses: d.expenses ?? [],
    });
    ids.set(d.key, p.id);
    for (let i = 0; i < d.photos; i += 1) {
      await addPropertyImage(
        db,
        agent,
        storage,
        { propertyId: p.id },
        {
          bytes: await demoImage(`${p.code} · Foto ${i + 1}`, photoVariant++),
          fileName: `demo-${i + 1}.jpg`,
        },
      );
    }
    if (d.video)
      await addPropertyVideo(db, agent, {
        propertyId: p.id,
        url: d.video,
        caption: "Recorrido (enlace DEMO)",
      });
    if (d.owners.length) {
      // Los propietarios DEMO los administra otra área: los asocia la administración.
      await setPropertyOwners(db, admin, {
        propertyId: p.id,
        owners: await Promise.all(
          d.owners.map(async (o) => ({ contactId: await ownerId(o.name), sharePercent: o.share })),
        ),
      });
    }
    if (d.prices.length) {
      // El mínimo autorizado lo fija la gerencia (el agente no tiene ese permiso).
      await setPrices(db, admin, { propertyId: p.id, prices: d.prices, reason: "Precio inicial acordado" });
      for (const list of d.reductions ?? []) {
        const base = d.prices[0];
        if (!base) continue;
        await setPrices(db, agent, {
          propertyId: p.id,
          prices: [{ ...base, list }, ...d.prices.slice(1)],
          reason: "Ajuste acordado con el propietario",
        });
      }
    }
  }

  // Captaciones: dos que terminaron en propiedades publicadas, una en negociación, una por
  // vencer la exclusividad, una perdida y una recién captada (crea su propiedad en borrador).
  const agente = await ctxForDemo(db, org.id, "agente");
  const agente2 = await ctxForDemo(db, org.id, "agente2");
  const gerente = await ctxForDemo(db, org.id, "gerente");
  const walk = async (ctx: RequestContext, id: string, stages: string[]) => {
    for (const stage of stages) await changeAcquisitionStage(db, ctx, { id, stage });
  };
  const OPEN = ["contacted", "valuation", "negotiation", "authorization"];

  let acquisitions = 0;
  for (const key of ["pocitos", "punta-carretas"]) {
    const pid = ids.get(key);
    if (!pid) continue;
    const a = await createAcquisition(db, admin, {
      ownerContactId: await ownerId("Laura Gómez"),
      captadorUserId: agente.userId,
      propertyId: pid,
      propertyType: "apartment",
      operation: "sale",
      ...zone(geo, "Montevideo", key === "pocitos" ? "Pocitos" : "Punta Carretas"),
      exclusive: true,
      exclusiveFrom: isoDay(-60),
      exclusiveUntil: isoDay(120),
      commissionPercent: "3",
      currency: "USD",
      askingPrice: key === "pocitos" ? "235.000" : "340.000",
      recommendedPrice: key === "pocitos" ? "225.000" : "330.000",
      publicationAuthorized: true,
      notes: "Captación DEMO.",
    });
    await walk(agente, a.id, [...OPEN, "captured"]);
    acquisitions += 1;
  }

  const negotiation = await createAcquisition(db, admin, {
    ownerContactId: await ownerId("Ricardo Sosa"),
    captadorUserId: agente.userId,
    propertyType: "apartment",
    operation: "sale",
    ...zone(geo, "Montevideo", "Malvín"),
    address: "Rambla Euskal Erría 4800",
    currency: "USD",
    askingPrice: "260.000",
    notes: "Duda entre vender o alquilar. Pidió tasación.",
  });
  await walk(agente, negotiation.id, ["contacted", "valuation", "negotiation"]);
  await createValuation(db, agente, {
    acquisitionId: negotiation.id,
    method: "comparables",
    currency: "USD",
    value: "238.000",
    min: "228.000",
    max: "248.000",
    valuedAt: isoDay(-5),
    comparables: [
      { address: "Rambla Euskal Erría 4700 (DEMO)", price: "245.000", areaM2: "95" },
      { address: "Av. Italia 5100 (DEMO)", price: "229.000", areaM2: "88" },
      { address: "Orinoco 5000 (DEMO)", price: "241.000", areaM2: "92" },
    ],
    notes: "Tasación DEMO por comparables de la zona.",
  });
  acquisitions += 1;

  const expiring = await createAcquisition(db, gerente, {
    ownerContactId: await ownerId("Beatriz Ferreira"),
    propertyType: "house",
    operation: "rent",
    ...zone(geo, "Montevideo", "Carrasco Norte"),
    exclusive: true,
    exclusiveFrom: isoDay(-160),
    exclusiveUntil: isoDay(20),
    commissionPercent: "8,33",
    currency: "UYU",
    askingPrice: "85.000",
    recommendedPrice: "80.000",
    notes: "La exclusividad vence pronto: conviene renovar o captar.",
  });
  await walk(gerente, expiring.id, OPEN);
  acquisitions += 1;

  const lost = await createAcquisition(db, agente2, {
    ownerContactId: await ownerId("Inversiones del Este"),
    propertyType: "apartment",
    operation: "temporary_rent",
    ...zone(geo, "Punta del Este", "Aidy Grill"),
    currency: "USD",
    askingPrice: "6.000",
  });
  await walk(agente2, lost.id, ["contacted"]);
  await changeAcquisitionStage(db, agente2, {
    id: lost.id,
    stage: "lost",
    lostReason: "Eligió otra inmobiliaria (DEMO)",
  });
  acquisitions += 1;

  const fresh = await createAcquisition(db, agente2, {
    ownerContactId: await ownerId("Inversiones del Este"),
    propertyType: "house",
    operation: "sale",
    ...zone(geo, "Punta del Este", "Pinares"),
    address: "Parada 35, Pinares",
    commissionPercent: "4",
    currency: "USD",
    askingPrice: "520.000",
    recommendedPrice: "495.000",
  });
  await walk(agente2, fresh.id, OPEN);
  const [freshRow] = await db.select().from(acquisition).where(eq(acquisition.id, fresh.id));
  if (freshRow) {
    await updateAcquisition(db, agente2, {
      id: fresh.id,
      ownerContactId: freshRow.ownerContactId,
      propertyType: freshRow.propertyType,
      operation: freshRow.operation,
      address: freshRow.address,
      localityId: freshRow.localityId,
      neighborhoodId: freshRow.neighborhoodId,
      commissionPercent: "4",
      currency: freshRow.currency,
      askingPrice: "520.000",
      recommendedPrice: "495.000",
      publicationAuthorized: true,
      notes: "Autorización firmada: se crea la propiedad en borrador para completar fotos.",
    });
    await changeAcquisitionStage(db, agente2, { id: fresh.id, stage: "captured" });
  }
  acquisitions += 1;

  // Estados finales (publicar mueve las captaciones captadas a "Publicado").
  for (const d of PROPERTIES) {
    const pid = ids.get(d.key);
    if (!pid || d.status === "draft") continue;
    const agent = await ctxForDemo(db, org.id, d.agent);
    if (d.status === "reserved") {
      await changePropertyStatus(db, agent, { propertyId: pid, status: "published" });
    }
    await changePropertyStatus(db, agent, {
      propertyId: pid,
      status: d.status,
      note:
        d.status === "reserved" ? "Reserva DEMO registrada a mano (las reservas llegan en la Fase 6)." : null,
    });
  }

  const pocitos = ids.get("pocitos");
  if (pocitos) {
    await createValuation(db, agente, {
      propertyId: pocitos,
      method: "comparables",
      currency: "USD",
      value: "225.000",
      min: "215.000",
      max: "235.000",
      valuedAt: isoDay(-70),
      comparables: [
        { address: "Av. Brasil 2600 (DEMO)", price: "232.000", areaM2: "75" },
        { address: "Benito Blanco 900 (DEMO)", price: "219.000", areaM2: "70" },
      ],
      notes: "Tasación DEMO previa a la captación.",
    });
    const doc = (
      name: string,
      type: string,
      visibility: "internal" | "restricted" | "confidential",
      expiresAt: string | null = null,
    ) =>
      uploadDocument(
        db,
        visibility === "confidential" ? admin : agente,
        storage,
        {
          entityType: "property",
          entityId: pocitos,
          category: "property",
          type,
          name,
          visibility,
          expiresAt,
        },
        { bytes: demoPdf(`${type} - ${name}`), fileName: `${name}.pdf` },
      );
    await doc("Plano de la unidad", "Plano", "internal");
    await doc("Título de propiedad", "Título de propiedad", "restricted");
    await doc("Certificado de contribución", "Certificado de contribución", "internal", isoDay(25));
    await doc("Autorización de venta firmada", "Autorización de venta", "confidential");
  }
  const laura = await ownerId("Laura Gómez");
  await uploadDocument(
    db,
    admin,
    storage,
    {
      entityType: "contact",
      entityId: laura,
      category: "owner",
      type: "Poder notarial",
      name: "Poder notarial (DEMO)",
      visibility: "restricted",
    },
    { bytes: demoPdf("Poder notarial"), fileName: "poder.pdf" },
  );

  const [total] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(property)
    .where(eq(property.organizationId, org.id));
  return { skipped: false, properties: total?.n ?? 0, acquisitions };
}
