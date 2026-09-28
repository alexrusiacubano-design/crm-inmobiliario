import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Los tests de integración usan una base Postgres real y la recrean en cada archivo:
    // se ejecutan en serie para no pisarse.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Clave solo para tests (32 bytes). En producción se configura FIELD_ENCRYPTION_KEY.
    env: { FIELD_ENCRYPTION_KEY: "dGVzdC1rZXktMzItYnl0ZXMtbG9uZy0wMTIzNDU2Nzg=" },
  },
});
