import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { botSettings, commissionSettings, organization, portalAccount, type Db, type DbOrTx } from "@crm/db";
import {
  DEFAULT_BOT_FAQS,
  DEFAULT_BOT_GREETING,
  DEFAULT_BOT_HANDOFF,
  extractPropertyCode,
  matchFaq,
} from "@crm/shared/bot";
import { PROPERTY_TYPE_LABELS, type PropertyType } from "@crm/shared/crm";
import { formatMoney } from "@crm/shared/money";
import { botActionSchema, botSettingsSchema } from "@crm/shared/validation/bot";
import { writeAudit } from "../audit";
import { requirePermission, type RequestContext } from "../context";
import { parseInput } from "../errors";
import { feedListings, readFeedMedia } from "../properties/publications";
import type { StorageProvider } from "../storage/provider";
import { ingestInquiry } from "./inbox";

const newToken = () => randomBytes(24).toString("hex");

async function ensureSettings(db: DbOrTx, organizationId: string) {
  await db
    .insert(botSettings)
    .values({
      organizationId,
      token: newToken(),
      greeting: DEFAULT_BOT_GREETING,
      handoffMessage: DEFAULT_BOT_HANDOFF,
      faqs: DEFAULT_BOT_FAQS,
    })
    .onConflictDoNothing();
  const [s] = await db.select().from(botSettings).where(eq(botSettings.organizationId, organizationId));
  if (!s) throw new Error("No se pudo crear la configuración del asistente");
  return s;
}

export async function getBotSettings(db: DbOrTx, ctx: RequestContext) {
  requirePermission(ctx, "automation.manage");
  return ensureSettings(db, ctx.organizationId);
}

export async function saveBotSettings(db: Db, ctx: RequestContext, rawInput: unknown) {
  requirePermission(ctx, "automation.manage");
  const input = parseInput(botSettingsSchema, rawInput);
  return db.transaction(async (tx) => {
    const before = await ensureSettings(tx, ctx.organizationId);
    const [after] = await tx
      .update(botSettings)
      .set(input)
      .where(eq(botSettings.organizationId, ctx.organizationId))
      .returning();
    await writeAudit(tx, ctx, {
      action: "bot.update",
      entityType: "organization",
      entityId: ctx.organizationId,
      before: { enabled: before.enabled, faqs: before.faqs.length },
      after: { enabled: input.enabled, faqs: input.faqs.length },
    });
    return after;
  });
}

export async function rotateBotToken(db: Db, ctx: RequestContext) {
  requirePermission(ctx, "automation.manage");
  await ensureSettings(db, ctx.organizationId);
  const [after] = await db
    .update(botSettings)
    .set({ token: newToken() })
    .where(eq(botSettings.organizationId, ctx.organizationId))
    .returning();
  await writeAudit(db, ctx, {
    action: "bot.rotate_token",
    entityType: "organization",
    entityId: ctx.organizationId,
  });
  return after;
}

export interface BotCard {
  code: string;
  title: string;
  zone: string;
  price: string;
  facts: string;
  photoId: string | null;
}
export type BotQuick =
  { label: string; action: unknown } | { label: string; contact: true; propertyCode?: string | null };
export interface BotReply {
  messages: string[];
  cards?: BotCard[];
  quick?: BotQuick[];
  done?: boolean;
}

async function loadBot(db: DbOrTx, token: string) {
  if (!/^[0-9a-f]{48}$/.test(token)) return null;
  const [s] = await db.select().from(botSettings).where(eq(botSettings.token, token));
  return s?.enabled ? s : null;
}

/** Propiedades publicadas en el sitio web propio (lo único que el asistente muestra). */
async function websiteListings(db: DbOrTx, organizationId: string) {
  const [acc] = await db
    .select({ token: portalAccount.feedToken })
    .from(portalAccount)
    .where(and(eq(portalAccount.organizationId, organizationId), eq(portalAccount.portal, "website")));
  if (!acc) return { token: null, listings: [] };
  const feed = await feedListings(db, acc.token);
  return { token: acc.token, listings: feed?.listings ?? [] };
}

type Listing = Awaited<ReturnType<typeof websiteListings>>["listings"][number];

function card(l: Listing, operation?: "sale" | "rent"): BotCard {
  const price = l.prices.find((x) => (operation ? x.operation === operation : true)) ?? l.prices[0] ?? null;
  const facts = [
    PROPERTY_TYPE_LABELS[l.p.type as PropertyType],
    l.p.bedrooms !== null ? `${l.p.bedrooms} dorm.` : null,
    l.p.builtArea ? `${Number(l.p.builtArea)} m²` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    code: l.p.code,
    title: l.p.title ?? l.p.code,
    zone: [l.neighborhoodName, l.localityName].filter(Boolean).join(", "),
    price:
      price?.listMinor != null
        ? `${price.operation === "sale" ? "Venta" : "Alquiler"} ${formatMoney(
            { amountMinor: price.listMinor, currency: price.currency },
            { showDecimals: "never" },
          )}`
        : "Consultar precio",
    facts,
    photoId: l.photoIds[0] ?? null,
  };
}

const MAIN_MENU: BotQuick[] = [
  { label: "Quiero comprar", action: { type: "search", operation: "sale" } },
  { label: "Quiero alquilar", action: { type: "search", operation: "rent" } },
  { label: "Preguntas frecuentes", action: { type: "message", text: "preguntas frecuentes" } },
  { label: "Hablar con un asesor", contact: true },
];

/** Responde una acción del chat público. null si el asistente no existe o está apagado. */
export async function botRespond(db: Db, token: string, rawAction: unknown): Promise<BotReply | null> {
  const bot = await loadBot(db, token);
  if (!bot) return null;
  const action = parseInput(botActionSchema, rawAction);

  if (action.type === "start") return { messages: [bot.greeting], quick: MAIN_MENU };

  if (action.type === "handoff") {
    await ingestInquiry(db, bot.organizationId, {
      channel: "bot",
      name: action.name,
      phone: action.phone,
      email: action.email,
      message:
        [action.message, action.transcript ? `Conversación:\n${action.transcript}` : null]
          .filter(Boolean)
          .join("\n\n")
          .slice(0, 4000) || "Pidió hablar con un asesor desde el chat del sitio.",
      propertyCode: action.propertyCode,
    });
    return { messages: [bot.handoffMessage], done: true };
  }

  if (action.type === "search") {
    const { listings } = await websiteListings(db, bot.organizationId);
    const [settings] = await db
      .select({ rate: commissionSettings.uyuPerUsd })
      .from(commissionSettings)
      .where(eq(commissionSettings.organizationId, bot.organizationId));
    const rate = settings ? Number(settings.rate) : 40;
    const wantCurrency = action.operation === "sale" ? "USD" : "UYU";
    const matches = listings
      .map((l) => ({ l, price: l.prices.find((x) => x.operation === action.operation) }))
      .filter((x) => x.price && (!action.propertyType || x.l.p.type === action.propertyType))
      .map((x) => {
        const amount = Number(x.price?.listMinor ?? 0n) / 100;
        const inWanted =
          x.price?.currency === wantCurrency
            ? amount
            : wantCurrency === "USD"
              ? amount / rate
              : amount * rate;
        return { ...x, inWanted };
      })
      .filter((x) => !action.maxPrice || x.inWanted <= action.maxPrice)
      .sort((a, b) => a.inWanted - b.inWanted)
      .slice(0, 6);
    if (!matches.length)
      return {
        messages: [
          "No encontré propiedades publicadas con esos datos. Dejame tus datos y un asesor te avisa cuando entre algo.",
        ],
        quick: [{ label: "Dejar mis datos", contact: true }, ...MAIN_MENU.slice(0, 2)],
      };
    return {
      messages: [`Encontré ${matches.length} ${matches.length === 1 ? "opción" : "opciones"}:`],
      cards: matches.map((m) => card(m.l, action.operation)),
      quick: [{ label: "Quiero que me contacten", contact: true }, ...MAIN_MENU.slice(0, 2)],
    };
  }

  // Mensaje libre: código de propiedad, pregunta frecuente o derivación.
  const text = action.text;
  const faqs = bot.faqs;
  if (/pregunta|faq|ayuda/i.test(text) && text.length < 40)
    return {
      messages: ["Estas son las preguntas más comunes:"],
      quick: faqs
        .slice(0, 8)
        .map((f) => ({ label: f.question, action: { type: "message", text: f.question } })),
    };
  const code = extractPropertyCode(text);
  if (code) {
    const { listings } = await websiteListings(db, bot.organizationId);
    const l = listings.find((x) => x.p.code === code);
    if (l)
      return {
        messages: ["Esta es la propiedad:"],
        cards: [card(l)],
        quick: [{ label: "Consultar por esta propiedad", contact: true, propertyCode: code }],
      };
    return {
      messages: [`La propiedad ${code} no está publicada ahora. ¿Querés que te contacte un asesor?`],
      quick: [{ label: "Sí, contactarme", contact: true, propertyCode: code }, ...MAIN_MENU.slice(0, 2)],
    };
  }
  const faq = matchFaq(text, faqs);
  if (faq) return { messages: [faq.answer], quick: MAIN_MENU };
  if (/compr/i.test(text))
    return { messages: ["¡Genial! Te muestro lo que tenemos en venta."], quick: [MAIN_MENU[0] as BotQuick] };
  if (/alquil|arrend/i.test(text))
    return { messages: ["Te muestro lo que tenemos en alquiler."], quick: [MAIN_MENU[1] as BotQuick] };
  return {
    messages: ["No tengo esa respuesta. Si me dejás tus datos, un asesor te responde personalmente."],
    quick: [{ label: "Dejar mis datos", contact: true, propertyCode: null }, ...MAIN_MENU.slice(0, 3)],
  };
}

/** Foto de una propiedad publicada en el sitio web, para mostrarla en el chat. */
export async function readBotMedia(
  db: DbOrTx,
  storage: StorageProvider,
  token: string,
  mediaId: string,
  size: "thumb" | "full",
) {
  const bot = await loadBot(db, token);
  if (!bot) return null;
  const [acc] = await db
    .select({ token: portalAccount.feedToken })
    .from(portalAccount)
    .where(and(eq(portalAccount.organizationId, bot.organizationId), eq(portalAccount.portal, "website")));
  return acc ? readFeedMedia(db, storage, acc.token, mediaId, size) : null;
}

/** Datos públicos para la página del chat (null si no existe o está apagado). */
export async function botPublicInfo(db: DbOrTx, token: string) {
  const bot = await loadBot(db, token);
  if (!bot) return null;
  const [org] = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, bot.organizationId));
  return { orgName: org?.name ?? "Inmobiliaria" };
}
