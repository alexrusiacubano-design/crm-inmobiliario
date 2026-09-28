import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.DEMO_PASSWORD ?? "Demo-2026!";

async function login(page: Page, user: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(`${user}@demo.example.com`);
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("un agente carga un lead con contacto nuevo, registra una llamada y el lead pasa a Contactado", async ({
  page,
}) => {
  const suffix = Date.now().toString().slice(-6);
  await login(page, "agente");
  await page.goto("/crm/leads");
  await page.getByRole("button", { name: "Nuevo lead" }).click();

  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nombre").fill("Prueba E2E");
  await dialog.getByLabel("Apellido").fill(`Lead ${suffix}`);
  await dialog.getByLabel("Teléfono 1").fill(`094 ${suffix.slice(0, 3)} ${suffix.slice(3)}`);
  await dialog.getByLabel("Busca").selectOption("rent");
  await dialog.getByLabel("Origen").selectOption("whatsapp");
  await dialog.getByRole("button", { name: "Crear lead" }).click();

  await expect(page).toHaveURL(/\/crm\/leads\/[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { name: new RegExp(`Prueba E2E Lead ${suffix}`) })).toBeVisible();
  await expect(page.getByText("Nuevo", { exact: true }).first()).toBeVisible();

  await page.getByLabel("Detalle").fill("Busca monoambiente cerca de facultad");
  await page.getByRole("button", { name: "Registrar" }).click();
  await expect(page.getByText("Registrado en el timeline")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Nuevo → Contactado (automático)")).toBeVisible();
  await expect(page.getByText("Busca monoambiente cerca de facultad")).toBeVisible();

  // La búsqueda global lo encuentra por teléfono.
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder("Nombre, teléfono, cédula, LEAD-… o PROP-…").fill(suffix);
  await expect(
    page.getByRole("option", { name: new RegExp(`Prueba E2E Lead ${suffix}`) }).first(),
  ).toBeVisible();
});

test("la cédula se valida en el servidor (dígito verificador)", async ({ page }) => {
  await login(page, "agente");
  await page.goto("/crm/contacts");
  await page.getByRole("button", { name: "Nuevo contacto" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nombre").fill("Cédula Mala");
  await dialog.getByLabel("Documento").selectOption("ci");
  await dialog.getByLabel("Número").fill("1.234.567-3");
  await dialog.getByRole("button", { name: "Crear contacto" }).click();
  await expect(dialog.getByText("Cédula inválida (dígito verificador)")).toBeVisible();
});

test("un agente no puede abrir por URL el contacto de otro agente", async ({ page }) => {
  // Lucía (agente2, Punta del Este) tiene a Camila Álvarez; Martín (agente) no debe verla.
  await login(page, "agente2");
  await page.goto("/crm/contacts?q=Camila");
  await page.getByRole("link", { name: "Camila Álvarez" }).click();
  await expect(page).toHaveURL(/\/crm\/contacts\/[0-9a-f-]{36}/);
  const url = page.url();

  await page.context().clearCookies();
  await login(page, "agente");
  await page.goto(url);
  await expect(page.getByText("Página no encontrada")).toBeVisible();
});

test("el administrador ve la cuenta bancaria enmascarada y la consulta queda auditada", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/crm/owners?q=Laura");
  await page.getByRole("link", { name: "Laura Gómez" }).click();
  await page.getByRole("link", { name: "Propietario", exact: true }).click();
  await expect(page.getByText("••••••••7890")).toBeVisible();
  await page.getByRole("button", { name: "Ver completo" }).click();
  await expect(page.getByText("001234567890")).toBeVisible();
  await page.goto("/admin/audit?action=owner.financial_view");
  await expect(page.locator("summary", { hasText: "Consulta de cuenta bancaria" }).first()).toBeVisible();
});

test("el director no ve datos bancarios", async ({ page }) => {
  await login(page, "director");
  await page.goto("/crm/owners?q=Laura");
  await page.getByRole("link", { name: "Laura Gómez" }).click();
  await page.getByRole("link", { name: "Propietario", exact: true }).click();
  await expect(page.getByText("Registrada (restringida a tu rol)")).toBeVisible();
  await expect(page.getByText("7890")).toHaveCount(0);
});
