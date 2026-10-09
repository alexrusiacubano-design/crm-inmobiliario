import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  locality,
  neighborhood,
  portalAccount,
  propertyMedia,
  propertyPublication,
  type DbHandle,
} from "@crm/db";
import { seedGeoUruguay } from "@crm/db/seed";
import {
  changePropertyStatus,
  changePublicationStatus,
  completeMercadoLibreConnection,
  createContact,
  createProperty,
  ForbiddenError,
  listPortalAccounts,
  mercadoLibreAuthorizeUrl,
  publishProperty,
  pushPublication,
  savePortalAccount,
  savePortalCredentials,
  setPrices,
  setPropertyOwners,
  testPortalConnection,
} from "../src";
import { createTestOrg, ctxFor, freshDb, type TestOrg } from "./fixtures";

let h: DbHandle;
let org: TestOrg;
const KEY = randomBytes(32).toString("base64");

beforeAll(async () => {
  h = await freshDb();
  await seedGeoUruguay(h.db);
  org = await createTestOrg(h.db, "mlc", {
    admin: { roleKey: "admin" },
    agente: { roleKey: "agent", inTeam: true },
  });
});
afterAll(async () => {
  await h.pool.end();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

type Call = { url: string; method: string; body: string };
function mockMl(handlers: Record<string, (c: Call) => unknown>, calls: Call[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const c = { url: String(url), method: init.method ?? "GET", body: String(init.body ?? "") };
      calls.push(c);
      const key = Object.keys(handlers).find((k) =>
        k.startsWith("PUT ")
          ? c.method === "PUT" && c.url.includes(k.slice(4))
          : c.method !== "PUT" && c.url.includes(k),
      );
      const res = key ? handlers[key]?.(c) : { message: "not mocked" };
      const status = (res as { __status?: number })?.__status ?? (key ? 200 : 404);
      return new Response(JSON.stringify(res), { status, headers: { "Content-Type": "application/json" } });
    }),
  );
}

describe("credenciales y Mercado Libre", () => {
  it("guarda cifrado, conecta por OAuth, publica, pausa y renueva el token", async () => {
    vi.stubEnv("FIELD_ENCRYPTION_KEY", KEY);
    vi.stubEnv("BETTER_AUTH_URL", "https://crm.example.com");
    const admin = await ctxFor(h.db, org, "admin");
    const agent = await ctxFor(h.db, org, "agente");
    await listPortalAccounts(h.db, admin);
    await expect(
      savePortalCredentials(h.db, agent, { portal: "mercadolibre", values: { appId: "1" } }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await savePortalCredentials(h.db, admin, {
      portal: "mercadolibre",
      values: { appId: "123456", clientSecret: "super-secreto-abcd" },
    });
    const [raw] = await h.db.select().from(portalAccount).where(eq(portalAccount.portal, "mercadolibre"));
    expect(raw?.credentialsEncrypted).not.toContain("super-secreto");
    expect(raw?.credentialHints).toEqual({ appId: "123456", clientSecret: "••••abcd" });
    // Secreto vacío: se conserva.
    await savePortalCredentials(h.db, admin, {
      portal: "mercadolibre",
      values: { appId: "123456", clientSecret: "" },
    });
    const listed = (await listPortalAccounts(h.db, admin)).find((a) => a.portal === "mercadolibre");
    expect(listed).toMatchObject({ hasCredentials: true, connected: false });
    expect(JSON.stringify(listed)).not.toContain("credentialsEncrypted");

    const url = new URL(await mercadoLibreAuthorizeUrl(h.db, admin, "https://crm.example.com"));
    expect(url.searchParams.get("client_id")).toBe("123456");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://crm.example.com/api/integrations/mercadolibre/callback",
    );
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    const state = url.searchParams.get("state") ?? "";

    const calls: Call[] = [];
    let expiresIn = 21600;
    mockMl(
      {
        "/oauth/token": (c) => {
          expect(c.body).toContain("client_secret=super-secreto-abcd");
          return {
            access_token: `tok-${calls.length}`,
            refresh_token: `ref-${calls.length}`,
            expires_in: expiresIn,
            user_id: 99,
          };
        },
        "/users/me": () => ({ id: 99, nickname: "INMODEMO" }),
        "/domain_discovery/search": () => [{ category_id: "MLU1474" }],
        "PUT /items/": () => ({ id: "MLU123", status: "paused" }),
        "/items": (c) => {
          const b = JSON.parse(c.body) as Record<string, unknown>;
          expect(b).toMatchObject({
            category_id: "MLU1474",
            currency_id: "USD",
            price: 180000,
            buying_mode: "classified",
          });
          expect(String((b.pictures as { source: string }[])[0]?.source)).toMatch(
            /^https:\/\/crm\.example\.com\/api\/feeds\/[0-9a-f]{48}\/media\//,
          );
          return { id: "MLU123", permalink: "https://apartamento.mercadolibre.com.uy/MLU-123" };
        },
      },
      calls,
    );
    await expect(
      completeMercadoLibreConnection(h.db, admin, {
        code: "c",
        state: "basura",
        base: "https://crm.example.com",
      }),
    ).rejects.toThrow("no es válida");
    const conn = await completeMercadoLibreConnection(h.db, admin, {
      code: "TG-1",
      state,
      base: "https://crm.example.com",
    });
    expect(conn.nickname).toBe("INMODEMO");
    expect(await testPortalConnection(h.db, admin, "mercadolibre")).toBe("Conectado como INMODEMO");

    // Propiedad lista para publicar.
    const [n] = await h.db
      .select({ localityId: locality.id, neighborhoodId: neighborhood.id })
      .from(neighborhood)
      .innerJoin(locality, eq(locality.id, neighborhood.localityId))
      .limit(1);
    const p = await createProperty(h.db, agent, {
      type: "apartment",
      operations: ["sale"],
      title: "Apartamento luminoso con balcón",
      description: "Apartamento de dos dormitorios, muy luminoso, con balcón al frente y cocina integrada.",
      localityId: n?.localityId,
      neighborhoodId: n?.neighborhoodId,
      bedrooms: 2,
    });
    await setPrices(h.db, agent, {
      propertyId: p.id,
      prices: [{ operation: "sale", currency: "USD", list: "180000" }],
    });
    const owner = (await createContact(h.db, agent, { firstName: "Due", lastName: "Ño" })).contact;
    await setPropertyOwners(h.db, agent, {
      propertyId: p.id,
      owners: [{ contactId: owner.id, sharePercent: "100" }],
    });
    for (let i = 0; i < 3; i++)
      await h.db.insert(propertyMedia).values({
        organizationId: org.organizationId,
        propertyId: p.id,
        kind: "photo",
        storageKey: `t/${p.id}/${i}.jpg`,
        mimeType: "image/jpeg",
        sizeBytes: 10,
        position: i,
        isCover: i === 0,
      });
    await changePropertyStatus(h.db, agent, { propertyId: p.id, status: "available" });
    await savePortalAccount(h.db, admin, { portal: "mercadolibre", enabled: true, quotas: {} });
    const pub = await publishProperty(h.db, admin, {
      propertyId: p.id,
      portal: "mercadolibre",
      level: "gold",
    });
    expect(await pushPublication(h.db, org.organizationId, pub?.id ?? "")).toBeNull();
    const [after] = await h.db
      .select()
      .from(propertyPublication)
      .where(eq(propertyPublication.id, pub?.id ?? ""));
    expect(after).toMatchObject({
      externalId: "MLU123",
      url: "https://apartamento.mercadolibre.com.uy/MLU-123",
      syncError: null,
    });

    // Pausar: PUT con status paused (con el token vencido se renueva primero).
    await h.db
      .update(portalAccount)
      .set({ connection: null })
      .where(eq(portalAccount.portal, "mercadolibre"));
    expiresIn = 1; // el próximo token vence enseguida
    await changePublicationStatus(h.db, admin, { id: pub?.id, status: "paused" });
    calls.length = 0;
    expect(await pushPublication(h.db, org.organizationId, pub?.id ?? "")).toBeNull();
    const put = calls.find((c) => c.method === "PUT");
    expect(put?.url).toContain("/items/MLU123");
    expect(JSON.parse(put?.body ?? "{}")).toEqual({ status: "paused" });
  });

  it("un error del portal queda en la publicación sin romper", async () => {
    const admin = await ctxFor(h.db, org, "admin");
    const [pub] = await h.db
      .select()
      .from(propertyPublication)
      .where(eq(propertyPublication.portal, "mercadolibre"));
    const calls: Call[] = [];
    mockMl(
      {
        "/oauth/token": () => ({ access_token: "t", refresh_token: "r", expires_in: 21600, user_id: 99 }),
        "PUT /items/": () => ({
          __status: 400,
          message: "validation_error",
          cause: [{ message: "price is invalid" }],
        }),
      },
      calls,
    );
    await changePublicationStatus(h.db, admin, { id: pub?.id, status: "published" });
    const err = await pushPublication(h.db, org.organizationId, pub?.id ?? "");
    expect(err).toContain("price is invalid");
    const [row] = await h.db
      .select()
      .from(propertyPublication)
      .where(eq(propertyPublication.id, pub?.id ?? ""));
    expect(row?.syncError).toContain("validation_error");
  });
});
