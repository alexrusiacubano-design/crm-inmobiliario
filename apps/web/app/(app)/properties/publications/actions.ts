"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import {
  ConflictError,
  changePublicationStatus,
  clearPortalCredentials,
  disconnectPortal,
  mercadoLibreAuthorizeUrl,
  publishProperty,
  pushPublication,
  savePortalCredentials,
  syncPortalsNow,
  testPortalConnection,
  rotateFeedToken,
  saveExchangeRate,
  savePortalAccount,
  updatePublication,
} from "@crm/core";
import { bcuRequestXml, parseBcuResponse, type Portal } from "@crm/shared/publications";
import { runAction, type ActionResult } from "@/lib/actions";
import { DEFAULT_TZ, ymdInTz } from "@/lib/tz";

function done<T>(r: ActionResult<T>): ActionResult<T> {
  if (r.ok) for (const p of ["/properties", "/admin"]) revalidatePath(p, "layout");
  return r;
}

/** Si el portal está conectado (Mercado Libre), lleva el cambio al portal y devuelve el error, si hubo. */
async function push(db: Parameters<typeof pushPublication>[0], orgId: string, id: string | undefined | null) {
  return id ? pushPublication(db, orgId, id) : null;
}

export async function publishPropertyAction(
  input: unknown,
): Promise<ActionResult<{ portalError: string | null }>> {
  return done(
    await runAction(async (db, ctx) => {
      const pub = await publishProperty(db, ctx, input);
      return { portalError: await push(db, ctx.organizationId, pub?.id) };
    }),
  );
}
export async function updatePublicationAction(
  input: unknown,
): Promise<ActionResult<{ portalError: string | null }>> {
  return done(
    await runAction(async (db, ctx) => {
      const pub = await updatePublication(db, ctx, input);
      return { portalError: await push(db, ctx.organizationId, pub?.id) };
    }),
  );
}
export async function changePublicationStatusAction(
  input: unknown,
): Promise<ActionResult<{ portalError: string | null }>> {
  return done(
    await runAction(async (db, ctx) => {
      const pub = await changePublicationStatus(db, ctx, input);
      return { portalError: await push(db, ctx.organizationId, pub?.id) };
    }),
  );
}

export async function savePortalCredentialsAction(input: unknown): Promise<ActionResult<undefined>> {
  return done(await runAction(async (db, ctx) => void (await savePortalCredentials(db, ctx, input))));
}
export async function clearPortalCredentialsAction(portal: Portal): Promise<ActionResult<undefined>> {
  return done(await runAction(async (db, ctx) => void (await clearPortalCredentials(db, ctx, portal))));
}
export async function testPortalAction(portal: Portal): Promise<ActionResult<{ message: string }>> {
  return done(await runAction(async (db, ctx) => ({ message: await testPortalConnection(db, ctx, portal) })));
}
export async function connectMercadoLibreAction(): Promise<ActionResult<{ url: string }>> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return runAction(async (db, ctx) => ({
    url: await mercadoLibreAuthorizeUrl(db, ctx, `${proto}://${host}`),
  }));
}
export async function disconnectPortalAction(portal: Portal): Promise<ActionResult<undefined>> {
  return done(await runAction(async (db, ctx) => void (await disconnectPortal(db, ctx, portal))));
}
export async function syncPortalsAction(): Promise<ActionResult<{ pushed: number }>> {
  return done(await runAction(async (db, ctx) => syncPortalsNow(db, ctx)));
}
export async function savePortalAccountAction(input: unknown): Promise<ActionResult<undefined>> {
  return done(await runAction(async (db, ctx) => void (await savePortalAccount(db, ctx, input))));
}
export async function rotateFeedTokenAction(portal: Portal): Promise<ActionResult<undefined>> {
  return done(await runAction(async (db, ctx) => void (await rotateFeedToken(db, ctx, portal))));
}
export async function saveExchangeRateAction(input: unknown): Promise<ActionResult<undefined>> {
  return done(await runAction(async (db, ctx) => void (await saveExchangeRate(db, ctx, input, "manual"))));
}

/** Trae la cotización del dólar billete del web service del BCU (últimos 7 días). */
export async function fetchBcuRateAction(): Promise<ActionResult<{ date: string; rate: string }>> {
  return done(
    await runAction(async (db, ctx) => {
      const tz = ctx.organization.timezone || DEFAULT_TZ;
      const to = ymdInTz(new Date(), tz);
      const from = ymdInTz(new Date(Date.now() - 7 * 86_400_000), tz);
      let xml: string;
      try {
        const res = await fetch("https://cotizaciones.bcu.gub.uy/wscotizaciones/servlet/awsbcucotizaciones", {
          method: "POST",
          headers: {
            "Content-Type": "text/xml; charset=utf-8",
            SOAPAction: "Cotizaaction/AWSBCUCOTIZACIONES.Execute",
          },
          body: bcuRequestXml(from, to),
          signal: AbortSignal.timeout(15_000),
          cache: "no-store",
        });
        xml = await res.text();
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (e) {
        throw new ConflictError(
          `No se pudo consultar al BCU (${e instanceof Error ? e.message : "sin respuesta"}). Cargalo a mano.`,
        );
      }
      const parsed = parseBcuResponse(xml);
      if (!parsed)
        throw new ConflictError("El BCU no devolvió cotizaciones para estos días. Cargalo a mano.");
      await saveExchangeRate(db, ctx, { date: parsed.date, rate: parsed.rate }, "bcu");
      return parsed;
    }),
  );
}
