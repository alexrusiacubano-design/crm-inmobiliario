import { getSiteEditor, siteOrganization } from "@crm/core";
import { getDb } from "@crm/db";
import type { Metadata } from "next";
import { SiteEditor } from "@/components/site-editor/site-editor";
import { PageHeader } from "@/components/ui/misc";
import { heroImageUrl } from "@/lib/site";
import { requirePagePermission } from "@/lib/session";

export const metadata: Metadata = { title: "Mi sitio web" };

export default async function WebsitePage() {
  const { ctx } = await requirePagePermission("settings.manage");
  const db = getDb();
  const [state, site] = await Promise.all([getSiteEditor(db, ctx), siteOrganization(db)]);
  // El sitio público muestra una sola inmobiliaria: si no es esta, se avisa.
  const isSiteOrg = site?.id === ctx.organizationId;
  return (
    <>
      <PageHeader
        title="Mi sitio web"
        description="Elegí el diseño, editá los textos y la imagen de portada, y publicá cuando esté listo."
      />
      {!isSiteOrg && (
        <p className="mb-4 rounded-lg border border-warning/50 bg-warning-soft px-4 py-3 text-sm">
          El sitio público está mostrando otra organización ({site?.name ?? "ninguna"}). Los cambios se
          guardan, pero no se van a ver hasta que el sitio apunte a esta inmobiliaria.
        </p>
      )}
      <SiteEditor
        initial={state.draft}
        heroUrl={state.draft.heroImageKey ? heroImageUrl(ctx.organizationId, state.draft.heroImageKey) : null}
        pending={state.pending}
        publishedAt={
          state.publishedAt
            ? new Intl.DateTimeFormat("es-UY", {
                dateStyle: "short",
                timeStyle: "short",
                timeZone: ctx.organization.timezone || "America/Montevideo",
              }).format(state.publishedAt)
            : null
        }
      />
    </>
  );
}
