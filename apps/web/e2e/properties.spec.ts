import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

const PASSWORD = process.env.DEMO_PASSWORD ?? "Demo-2026!";

async function login(page: Page, user: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(`${user}@demo.example.com`);
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

const tabs = (page: Page) => page.getByRole("navigation", { name: "Secciones de la propiedad" });

const photo = (r: number, g: number, b: number) =>
  sharp({ create: { width: 900, height: 600, channels: 3, background: { r, g, b } } })
    .jpeg()
    .toBuffer();

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

test("un agente crea una propiedad, completa la ficha, la publica y carga un documento", async ({ page }) => {
  const suffix = Date.now().toString().slice(-6);
  const title = `Apartamento E2E ${suffix} en Pocitos`;
  await login(page, "agente");

  await page.goto("/properties/new");
  await page.getByLabel("Título").fill(title);
  await page
    .getByLabel("Descripción")
    .fill("Apartamento de prueba automatizada con dos dormitorios, living comedor y balcón al frente.");
  await page.getByLabel("Localidad").selectOption({ label: "Montevideo" });
  await page.getByLabel("Barrio").selectOption({ label: "Pocitos" });
  await page.getByLabel("Dormitorios").fill("2");
  await page.getByRole("button", { name: "Crear propiedad" }).click();

  await expect(page).toHaveURL(/\/properties\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: new RegExp(title) })).toBeVisible();
  await expect(page.getByText("Borrador", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Al menos 3 fotos")).toBeVisible();
  const url = page.url();

  // Fotos: se suben por la ruta protegida y el servidor genera miniaturas.
  await tabs(page)
    .getByRole("link", { name: /Fotos y videos/ })
    .click();
  await page.locator("#media-upload").setInputFiles([
    { name: "a.jpg", mimeType: "image/jpeg", buffer: await photo(200, 80, 80) },
    { name: "b.jpg", mimeType: "image/jpeg", buffer: await photo(80, 200, 80) },
    { name: "c.jpg", mimeType: "image/jpeg", buffer: await photo(80, 80, 200) },
  ]);
  await expect(page.getByText("3 archivos subidos")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Portada", { exact: true })).toBeVisible();
  // Un archivo que no es imagen se rechaza por su contenido, aunque diga .jpg.
  await page
    .locator("#media-upload")
    .setInputFiles([
      { name: "falso.jpg", mimeType: "image/jpeg", buffer: Buffer.from("<html>no soy una foto</html>") },
    ]);
  await expect(page.getByText(/falso\.jpg: Formato no admitido/)).toBeVisible();

  // Precio.
  await tabs(page).getByRole("link", { name: "Precios", exact: true }).click();
  await page.getByRole("button", { name: "Editar precios" }).click();
  await page.getByRole("dialog").getByLabel("Publicado").fill("189.000");
  await page.getByRole("button", { name: "Guardar precios" }).click();
  await expect(page.getByText("Precios actualizados")).toBeVisible();
  await expect(page.getByRole("cell", { name: "U$S 189.000" }).first()).toBeVisible();

  // Propietario (contacto que el agente ve).
  await page.goto(url);
  await page.getByRole("button", { name: "Editar propietarios" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Buscar contacto").fill("Juan Pérez");
  await dialog
    .getByRole("button", { name: /Juan Pérez/ })
    .first()
    .click();
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Propietarios actualizados")).toBeVisible();

  // Publicar.
  await page.getByRole("button", { name: "Publicar" }).click();
  await expect(page.getByText("Estado: Publicado")).toBeVisible();
  await expect(page.getByText("Publicado", { exact: true }).first()).toBeVisible();

  // Documento con descarga auditada.
  await tabs(page).getByRole("link", { name: "Documentos", exact: true }).click();
  await page.getByRole("button", { name: "Cargar documento" }).click();
  await page
    .getByLabel("Archivo")
    .setInputFiles({ name: "plano.pdf", mimeType: "application/pdf", buffer: PDF });
  await page.getByLabel("Tipo de documento").fill("Plano");
  await page.getByRole("dialog").getByRole("button", { name: "Cargar" }).click();
  await expect(page.getByText("Documento cargado")).toBeVisible();
  const download = page.getByRole("link", { name: "Descargar plano" });
  const res = await page.request.get((await download.getAttribute("href")) ?? "");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("application/pdf");

  // La búsqueda global la encuentra.
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder("Nombre, teléfono, cédula, LEAD-… o PROP-…").fill(suffix);
  await expect(page.getByRole("option", { name: new RegExp(title) })).toBeVisible();
});

test("otro agente ve la propiedad pero no puede editarla ni ver el mínimo", async ({ page }) => {
  await login(page, "agente2");
  await page.goto("/properties?q=Pocitos");
  await page.getByRole("link", { name: /Apartamento 2 dormitorios con garaje en Pocitos/ }).click();
  await expect(page.getByRole("heading", { name: /Pocitos/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Editar" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Editar propietarios" })).toHaveCount(0);
  await tabs(page).getByRole("link", { name: "Precios", exact: true }).click();
  await expect(page.getByText("Restringido")).toBeVisible();
  await expect(page.getByRole("button", { name: "Editar precios" })).toHaveCount(0);
});

test("las fotos y documentos no se sirven sin sesión", async ({ request }) => {
  const res = await request.get("/api/media/00000000-0000-4000-8000-000000000000", { maxRedirects: 0 });
  expect([302, 307, 401]).toContain(res.status());
});
