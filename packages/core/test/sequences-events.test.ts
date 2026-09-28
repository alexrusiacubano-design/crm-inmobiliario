import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { domainEvent, type DbHandle } from "@crm/db";
import { dispatchPendingEvents, emitEvent, formatCode, nextCode, type EventHandler } from "../src";
import { createTestOrg, ctxFor, freshDb, type TestOrg } from "./fixtures";

let h: DbHandle;
let org: TestOrg;
let other: TestOrg;

beforeAll(async () => {
  h = await freshDb();
  org = await createTestOrg(h.db, "seq", { admin: { roleKey: "admin" } });
  other = await createTestOrg(h.db, "seq2", { admin: { roleKey: "admin" } });
});
afterAll(async () => {
  await h.pool.end();
});

describe("secuencias", () => {
  it("formatea con 6 dígitos", () => {
    expect(formatCode("PROP", 1n)).toBe("PROP-000001");
    expect(formatCode("OP", 1_234_567n)).toBe("OP-1234567");
  });

  it("50 altas concurrentes reciben números únicos y consecutivos", async () => {
    const codes = await Promise.all(
      Array.from({ length: 50 }, () => h.db.transaction((tx) => nextCode(tx, org.organizationId, "PROP"))),
    );
    const numbers = codes.map((c) => Number(c.split("-")[1])).sort((x, y) => x - y);
    expect(new Set(codes).size).toBe(50);
    expect(numbers).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });

  it("una transacción revertida no deja huecos", async () => {
    await expect(
      h.db.transaction(async (tx) => {
        await nextCode(tx, org.organizationId, "CTR");
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await h.db.transaction((tx) => nextCode(tx, org.organizationId, "CTR"))).toBe("CTR-000001");
  });

  it("cada organización tiene su propia numeración", async () => {
    expect(await h.db.transaction((tx) => nextCode(tx, other.organizationId, "PROP"))).toBe("PROP-000001");
  });
});

describe("outbox de eventos", () => {
  it("entrega los eventos y registra los fallos para reintentar", async () => {
    const ctx = await ctxFor(h.db, org, "admin");
    await h.db.transaction(async (tx) => {
      await emitEvent(tx, ctx, { type: "test.ok", aggregateType: "test", aggregateId: "1" });
      await emitEvent(tx, ctx, { type: "test.fail", aggregateType: "test", aggregateId: "2" });
    });

    const seen: string[] = [];
    const ok: EventHandler = async (e) => {
      seen.push(e.aggregateId);
    };
    const fail: EventHandler = async () => {
      throw new Error("proveedor caído");
    };
    const handlers = new Map([
      ["test.ok", [ok]],
      ["test.fail", [fail]],
    ]);

    await dispatchPendingEvents(h.db, handlers);
    expect(seen).toEqual(["1"]);

    const [okRow] = await h.db.select().from(domainEvent).where(eq(domainEvent.aggregateId, "1"));
    const [failRow] = await h.db.select().from(domainEvent).where(eq(domainEvent.aggregateId, "2"));
    expect(okRow?.processedAt).not.toBeNull();
    expect(failRow?.processedAt).toBeNull();
    expect(failRow?.attempts).toBe(1);
    expect(failRow?.lastError).toBe("proveedor caído");
  });
});
