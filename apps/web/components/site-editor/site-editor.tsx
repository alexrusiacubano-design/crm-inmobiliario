"use client";

import {
  SITE_THEME_LABELS,
  SITE_THEME_TOKENS,
  SITE_THEMES,
  type SiteContent,
  type SiteTheme,
} from "@crm/shared/site";
import { Check, ExternalLink, ImageUp, RotateCw, Rocket, Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { publishSiteAction, saveSiteDraftAction } from "@/app/(app)/admin/website/actions";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Badge, Card } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

type Draft = Omit<SiteContent, "heroImageKey">;

function ThemeThumb({ theme }: { theme: SiteTheme }) {
  const t = SITE_THEME_TOKENS[theme];
  return (
    <div className="aspect-[16/10] overflow-hidden rounded-md border" style={{ background: t.bg }}>
      <div
        className="flex items-center justify-between px-2 py-1.5"
        style={{ borderBottom: `1px solid ${t.border}` }}
      >
        <span className="h-1.5 w-8 rounded" style={{ background: t.accent }} />
        <span className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-1 w-3 rounded" style={{ background: t.muted2 }} />
          ))}
        </span>
      </div>
      <div className="space-y-1.5 px-3 pt-3">
        <span className="block h-2 w-3/4 rounded" style={{ background: t.text }} />
        <span className="block h-2 w-1/2 rounded" style={{ background: t.accent }} />
        <span className="block h-1 w-2/3 rounded" style={{ background: t.muted2 }} />
        <span
          className="mt-2 block h-3 w-1/3 rounded"
          style={{ background: `linear-gradient(90deg, ${t.accentFrom}, ${t.accentTo})` }}
        />
      </div>
    </div>
  );
}

export function SiteEditor({
  initial,
  heroUrl,
  pending,
  publishedAt,
}: {
  initial: SiteContent;
  heroUrl: string | null;
  pending: boolean;
  publishedAt: string | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"preview" | "edit">("preview");
  const { heroImageKey: _k, ...rest } = initial;
  const [v, setV] = useState<Draft>(rest);
  const [dirty, setDirty] = useState(false);
  const [frameKey, setFrameKey] = useState(0);
  const [busy, start] = useTransition();
  const [uploading, setUploading] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Draft>(k: K, value: Draft[K]) => {
    setV((p) => ({ ...p, [k]: value }));
    setDirty(true);
  };

  const save = (patch: Partial<Draft> = {}, opts: { removeHeroImage?: boolean; silent?: boolean } = {}) =>
    start(async () => {
      const next = { ...v, ...patch };
      const r = await saveSiteDraftAction({ ...next, removeHeroImage: opts.removeHeroImage ?? false });
      if (!r.ok) return void toast.error(r.error);
      setV(next);
      setDirty(false);
      setFrameKey((k) => k + 1);
      if (!opts.silent) toast.success("Borrador guardado");
      router.refresh();
    });

  const publish = () =>
    start(async () => {
      const r = await publishSiteAction({ ...v, removeHeroImage: false });
      if (!r.ok) return void toast.error(r.error);
      setDirty(false);
      setFrameKey((k) => k + 1);
      toast.success("¡Sitio publicado!");
      router.refresh();
    });

  const upload = async (f: File) => {
    setUploading(true);
    try {
      if (dirty) {
        const r = await saveSiteDraftAction({ ...v, removeHeroImage: false });
        if (!r.ok) return void toast.error(r.error);
        setDirty(false);
      }
      const body = new FormData();
      body.set("file", f);
      const res = await fetch("/api/organization/site-image", { method: "POST", body });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) toast.error(data.error ?? "No se pudo subir la imagen");
      else {
        toast.success("Imagen de portada actualizada");
        setFrameKey((k) => k + 1);
        router.refresh();
      }
    } catch {
      toast.error("Error de red");
    } finally {
      setUploading(false);
      if (file.current) file.current.value = "";
    }
  };

  const status = dirty
    ? { tone: "warning" as const, label: "Sin guardar" }
    : pending
      ? { tone: "neutral" as const, label: publishedAt ? "Cambios sin publicar" : "Borrador" }
      : { tone: "success" as const, label: "Publicado" };

  return (
    <div className="grid gap-4">
      <Card className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <nav className="flex rounded-lg border bg-surface-muted p-0.5 text-sm" aria-label="Secciones">
            {(
              [
                ["preview", "Vista previa"],
                ["edit", "Editar"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                aria-pressed={tab === k}
                className={cn(
                  "rounded-md px-3 py-1.5",
                  tab === k
                    ? "bg-surface font-medium shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </nav>
          <Badge tone={status.tone}>{status.label}</Badge>
          {publishedAt && (
            <span className="hidden text-xs text-muted-foreground sm:inline">
              Última publicación {publishedAt}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="ghost" size="sm">
            <a href="/" target="_blank" rel="noopener noreferrer">
              <ExternalLink /> Ver sitio
            </a>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={busy && dirty}
            disabled={busy}
            onClick={() => save()}
          >
            <Save /> Guardar
          </Button>
          <Button size="sm" disabled={busy} onClick={publish}>
            <Rocket /> Publicar
          </Button>
        </div>
      </Card>

      {tab === "preview" ? (
        <>
          <Card className="p-4">
            <p className="mb-3 text-sm font-medium">Elegí tu diseño</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {SITE_THEMES.map((t) => (
                <button
                  key={t}
                  type="button"
                  disabled={busy}
                  onClick={() => t !== v.theme && save({ theme: t }, { silent: true })}
                  className={cn(
                    "rounded-xl border p-2 text-left transition hover:border-border-strong",
                    v.theme === t && "border-primary ring-2 ring-primary/30",
                  )}
                >
                  <ThemeThumb theme={t} />
                  <p className="mt-2 flex items-center gap-1.5 text-sm font-medium">
                    {SITE_THEME_LABELS[t].name}
                    {v.theme === t && <Check className="size-4 text-primary" />}
                  </p>
                  <p className="text-xs text-muted-foreground">{SITE_THEME_LABELS[t].hint}</p>
                </button>
              ))}
            </div>
          </Card>
          <Card className="overflow-hidden">
            <div className="flex items-center gap-2 border-b bg-surface-muted px-3 py-2">
              <span className="flex gap-1.5">
                <span className="size-2.5 rounded-full bg-[#ff5f57]" />
                <span className="size-2.5 rounded-full bg-[#febc2e]" />
                <span className="size-2.5 rounded-full bg-[#28c840]" />
              </span>
              <span className="mx-auto truncate rounded-md bg-surface px-3 py-0.5 text-xs text-muted-foreground">
                Vista previa del borrador{dirty ? " · guardá para ver los últimos cambios" : ""}
              </span>
              <button
                type="button"
                onClick={() => setFrameKey((k) => k + 1)}
                aria-label="Recargar vista previa"
                className="text-muted-foreground hover:text-foreground"
              >
                <RotateCw className="size-4" />
              </button>
            </div>
            <iframe
              key={frameKey}
              src="/?vista=borrador"
              title="Vista previa del sitio"
              className="h-[75vh] min-h-[560px] w-full bg-white"
            />
          </Card>
        </>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="grid content-start gap-4 p-5">
            <h2 className="font-semibold">Portada</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Título" htmlFor="s-title" hint="Primera parte, en color de texto">
                <Input
                  id="s-title"
                  value={v.heroTitle}
                  maxLength={80}
                  onChange={(e) => set("heroTitle", e.target.value)}
                />
              </Field>
              <Field label="Título destacado" htmlFor="s-hl" hint="Segunda parte, en color de acento">
                <Input
                  id="s-hl"
                  value={v.heroHighlight}
                  maxLength={80}
                  onChange={(e) => set("heroHighlight", e.target.value)}
                />
              </Field>
            </div>
            <Field label="Bajada" htmlFor="s-sub">
              <Textarea
                id="s-sub"
                rows={3}
                value={v.heroSubtitle}
                maxLength={300}
                onChange={(e) => set("heroSubtitle", e.target.value)}
              />
            </Field>
            <div className="grid gap-2">
              <p className="text-sm font-medium">Imagen de portada</p>
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex aspect-[16/9] w-48 items-center justify-center overflow-hidden rounded-lg border bg-surface-muted">
                  {heroUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={heroUrl} alt="Portada" className="size-full object-cover" />
                  ) : (
                    <span className="px-3 text-center text-xs text-muted-foreground">
                      Sin imagen: se usa la foto de la última propiedad publicada
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <input
                    ref={file}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void upload(f);
                    }}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={uploading}
                    onClick={() => file.current?.click()}
                  >
                    <ImageUp /> {heroUrl ? "Cambiar imagen" : "Subir imagen"}
                  </Button>
                  {heroUrl && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => save({}, { removeHeroImage: true })}
                    >
                      <Trash2 /> Quitar
                    </Button>
                  )}
                  <p className="text-xs text-muted-foreground">JPG, PNG o WebP · hasta 10 MB · horizontal</p>
                </div>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={v.showWelcome}
                onChange={(e) => set("showWelcome", e.target.checked)}
              />
              Mostrar la bienvenida «¿Qué te trae hoy?» a los visitantes nuevos
            </label>
          </Card>

          <Card className="grid content-start gap-4 p-5">
            <h2 className="font-semibold">Secciones</h2>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={v.showValuation}
                onChange={(e) => set("showValuation", e.target.checked)}
              />
              Mostrar la sección de tasación gratuita
            </label>
            <Field label="Título de tasación" htmlFor="s-vt">
              <Input
                id="s-vt"
                value={v.valuationTitle}
                maxLength={80}
                disabled={!v.showValuation}
                onChange={(e) => set("valuationTitle", e.target.value)}
              />
            </Field>
            <Field label="Texto de tasación" htmlFor="s-vx">
              <Textarea
                id="s-vx"
                rows={3}
                value={v.valuationText}
                maxLength={400}
                disabled={!v.showValuation}
                onChange={(e) => set("valuationText", e.target.value)}
              />
            </Field>
            <Field
              label="Título del cierre"
              htmlFor="s-cta"
              hint="El bloque de contacto al final de la página"
            >
              <Input
                id="s-cta"
                value={v.ctaTitle}
                maxLength={80}
                onChange={(e) => set("ctaTitle", e.target.value)}
              />
            </Field>
            <Field label="Texto del pie de página" htmlFor="s-foot">
              <Textarea
                id="s-foot"
                rows={2}
                value={v.footerText}
                maxLength={300}
                onChange={(e) => set("footerText", e.target.value)}
              />
            </Field>
            <p className="text-xs text-muted-foreground">
              Los campos que dejes vacíos vuelven al texto original. El logo, el teléfono y el email se
              cambian en Configuración.
            </p>
          </Card>
        </div>
      )}
    </div>
  );
}
