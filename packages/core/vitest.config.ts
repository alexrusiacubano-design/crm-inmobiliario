import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Los tests de integración usan una base Postgres real y la recrean en cada archivo:
    // se ejecutan en serie para no pisarse.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
