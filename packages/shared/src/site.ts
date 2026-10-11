import { z } from "zod";

/**
 * Contenido editable del sitio público ("Mi sitio web"). Se guarda un borrador y una versión
 * publicada; el sitio muestra la publicada.
 */

export const SITE_THEMES = ["sage", "gold", "light", "navy"] as const;
export type SiteTheme = (typeof SITE_THEMES)[number];
export const SITE_THEME_LABELS: Record<SiteTheme, { name: string; hint: string }> = {
  sage: { name: "Arena y oliva", hint: "Crema cálido, oliva y terracota" },
  gold: { name: "Oscuro dorado", hint: "Negro con acentos dorados" },
  light: { name: "Claro clásico", hint: "Marfil con acentos tostados" },
  navy: { name: "Azul noche", hint: "Oscuro con acento celeste" },
};

export interface SiteThemeTokens {
  scheme: "dark" | "light";
  bg: string;
  bg2: string;
  surface: string;
  surface2: string;
  text: string;
  text2: string;
  muted: string;
  muted2: string;
  accent: string;
  accentFrom: string;
  accentTo: string;
  onAccent: string;
  border: string;
  borderStrong: string;
  hover: string;
  /** Color de detalle (etiquetas, íconos): terracota en «Arena y oliva». */
  detail: string;
}

export const SITE_THEME_TOKENS: Record<SiteTheme, SiteThemeTokens> = {
  sage: {
    scheme: "light",
    bg: "#f7f4ee",
    bg2: "#efeae0",
    surface: "#ffffff",
    surface2: "#ece7dc",
    text: "#23271f",
    text2: "#3f4539",
    muted: "#6a7062",
    muted2: "#8c9184",
    accent: "#5b7a4f",
    accentFrom: "#6e8f60",
    accentTo: "#4f6b44",
    onAccent: "#ffffff",
    border: "#e3ddd1",
    borderStrong: "#d2cabb",
    hover: "rgba(35,39,31,0.05)",
    detail: "#c9764a",
  },
  gold: {
    scheme: "dark",
    bg: "#0a0a0a",
    bg2: "#0e0e0e",
    surface: "#141414",
    surface2: "#1c1c1c",
    text: "#f2efe9",
    text2: "#cfc9bf",
    muted: "#a8a29a",
    muted2: "#8c867c",
    accent: "#d8bf82",
    accentFrom: "#e3cd96",
    accentTo: "#b99a5b",
    onAccent: "#0a0a0a",
    border: "rgba(255,255,255,0.1)",
    borderStrong: "rgba(255,255,255,0.2)",
    hover: "rgba(255,255,255,0.05)",
    detail: "#d8bf82",
  },
  light: {
    scheme: "light",
    bg: "#faf8f5",
    bg2: "#f3efe8",
    surface: "#ffffff",
    surface2: "#efeae2",
    text: "#1c1b19",
    text2: "#3d3a35",
    muted: "#6b665e",
    muted2: "#8a847a",
    accent: "#8a6d3b",
    accentFrom: "#a8864c",
    accentTo: "#7a5e2e",
    onAccent: "#ffffff",
    border: "#e7e2da",
    borderStrong: "#d6cfc4",
    hover: "rgba(0,0,0,0.04)",
    detail: "#8a6d3b",
  },
  navy: {
    scheme: "dark",
    bg: "#0b1220",
    bg2: "#0e1628",
    surface: "#121b2e",
    surface2: "#1a2540",
    text: "#eef2f8",
    text2: "#c8d1e0",
    muted: "#94a3bb",
    muted2: "#7a879e",
    accent: "#8ab4f8",
    accentFrom: "#a5c8ff",
    accentTo: "#6d9be8",
    onAccent: "#0b1220",
    border: "rgba(255,255,255,0.1)",
    borderStrong: "rgba(255,255,255,0.2)",
    hover: "rgba(255,255,255,0.05)",
    detail: "#8ab4f8",
  },
};

/** Variables CSS del tema, para un `style` o una regla `.site{…}`. */
export function siteThemeCss(theme: SiteTheme): string {
  const t = SITE_THEME_TOKENS[theme];
  const vars: [string, string][] = [
    ["bg", t.bg],
    ["bg2", t.bg2],
    ["surface", t.surface],
    ["surface2", t.surface2],
    ["text", t.text],
    ["text2", t.text2],
    ["muted", t.muted],
    ["muted2", t.muted2],
    ["accent", t.accent],
    ["accent-from", t.accentFrom],
    ["accent-to", t.accentTo],
    ["on-accent", t.onAccent],
    ["border", t.border],
    ["border-strong", t.borderStrong],
    ["hover", t.hover],
    ["detail", t.detail],
  ];
  return `${vars.map(([k, v]) => `--site-${k}:${v}`).join(";")};color-scheme:${t.scheme}`;
}

const text = (max: number) => z.string().trim().max(max);

export const siteContentSchema = z.object({
  theme: z.enum(SITE_THEMES).default("sage"),
  heroTitle: text(80).default("Encontrá la propiedad"),
  heroHighlight: text(80).default("que estás buscando"),
  heroSubtitle: text(300).default(
    "Casas, apartamentos, oficinas y terrenos seleccionados uno por uno. Con un equipo que te asesora en cada paso, hasta la firma.",
  ),
  /** Imagen de portada subida (clave de almacenamiento). Sin imagen: la foto de la última propiedad. */
  heroImageKey: z.string().max(300).nullable().default(null),
  showWelcome: z.boolean().default(true),
  showValuation: z.boolean().default(true),
  valuationTitle: text(80).default("¿Cuánto vale tu propiedad?"),
  valuationText: text(400).default(
    "Completá el formulario en un minuto. Un tasador profesional analiza los datos y comparables de la zona y te contacta con un rango de valor fundamentado.",
  ),
  ctaTitle: text(80).default("¿Hablamos de tu próxima propiedad?"),
  footerText: text(300).default(
    "Propiedades seleccionadas en venta y alquiler, con asesoramiento en cada paso hasta la firma.",
  ),
});
export type SiteContent = z.infer<typeof siteContentSchema>;

export const SITE_DEFAULTS: SiteContent = siteContentSchema.parse({});

/** Contenido con valores por defecto para lo que falte, esté vacío o corrupto. */
export function siteContentOf(raw: unknown): SiteContent {
  const parsed = siteContentSchema.safeParse(raw ?? {});
  const c = parsed.success ? parsed.data : { ...SITE_DEFAULTS };
  for (const k of Object.keys(c) as (keyof SiteContent)[]) {
    if (typeof c[k] === "string" && !(c[k] as string).trim() && k !== "heroImageKey") {
      (c as Record<string, unknown>)[k] = SITE_DEFAULTS[k];
    }
  }
  return c;
}

/** Lo que manda el editor: la imagen se sube aparte; acá solo se puede quitar. */
export const siteContentInputSchema = siteContentSchema
  .omit({ heroImageKey: true })
  .extend({ removeHeroImage: z.boolean().optional().default(false) });
