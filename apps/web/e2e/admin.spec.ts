import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.DEMO_PASSWORD ?? "Demo-2026!";

async function login(page: Page, user: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(`${user}@demo.example.com`);
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("rechaza credenciales incorrectas", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("admin@demo.example.com");
  await page.getByLabel("Contraseña").fill("incorrecta-123");
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page.getByText("Email o contraseña incorrectos.")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("sin sesión, las rutas privadas redirigen al login", async ({ page }) => {
  await page.goto("/admin/users");
  await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Fusers/);
});

test("un administrador crea un usuario y queda auditado", async ({ page }) => {
  const email = `e2e.${Date.now()}@demo.example.com`;
  await login(page, "admin");

  await page
    .getByRole("navigation", { name: "Navegación principal" })
    .getByRole("link", { name: "Usuarios", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Usuarios" })).toBeVisible();
  await page.getByRole("button", { name: "Nuevo usuario" }).click();

  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nombre completo").fill("Usuario E2E (DEMO)");
  await dialog.getByLabel("Email").fill(email);
  await dialog.getByLabel("Contraseña inicial").fill("Prueba-E2E-2026");
  await dialog.getByRole("checkbox", { name: /^Agente/ }).check();
  await dialog.getByRole("button", { name: "Crear usuario" }).click();

  await expect(page.getByText("Usuario creado")).toBeVisible();
  await page.getByRole("searchbox").fill(email);
  await expect(page.getByRole("cell", { name: new RegExp(email) })).toBeVisible();

  await page.goto("/admin/audit?action=user.create");
  await expect(page.locator("summary", { hasText: "Alta de usuario" }).first()).toBeVisible();
});

test("el servidor valida aunque el formulario se envíe incompleto", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/admin/users");
  await page.getByRole("button", { name: "Nuevo usuario" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nombre completo").fill("Sin rol");
  await dialog.getByLabel("Email").fill("sin-rol@demo.example.com");
  await dialog.getByLabel("Contraseña inicial").fill("corta");
  await dialog.getByRole("button", { name: "Crear usuario" }).click();
  await expect(dialog.getByText(/al menos 10 caracteres/)).toBeVisible();
});

test("un agente no ve administración y recibe acceso denegado si entra por URL", async ({ page }) => {
  await login(page, "agente");
  await expect(
    page.getByRole("navigation", { name: "Navegación principal" }).getByText("Administración"),
  ).toHaveCount(0);
  await page.goto("/admin/users");
  await expect(page).toHaveURL(/\/forbidden/);
  await expect(page.getByText("No tenés acceso a esta sección")).toBeVisible();
});

test("los módulos futuros dicen en qué fase llegan, sin datos falsos", async ({ page }) => {
  await login(page, "director");
  await page.goto("/crm/leads");
  await expect(page.getByText("Este módulo se construye en la Fase 2")).toBeVisible();
});
