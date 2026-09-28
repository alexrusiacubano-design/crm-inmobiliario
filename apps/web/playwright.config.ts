import { defineConfig, devices } from "@playwright/test";

/**
 * E2E contra la app real con la base DEMO sembrada (`pnpm db:migrate && pnpm db:seed`).
 * Si la app ya corre en BASE_URL la reutiliza; si no, la levanta con `next start`.
 */
const baseURL = process.env.BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    locale: "es-UY",
    timezoneId: "America/Montevideo",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
          : {},
      },
    },
  ],
  webServer: {
    // Almacenamiento local habilitado solo para E2E (en producción real se usa S3/R2).
    command: "pnpm build && AUTH_SIGNIN_MAX_PER_MINUTE=100 STORAGE_ALLOW_LOCAL=1 pnpm start",
    url: `${baseURL}/login`,
    reuseExistingServer: true,
    timeout: 240_000,
  },
});
