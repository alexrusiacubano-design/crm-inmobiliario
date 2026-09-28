import { Hammer } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { hasPermission } from "@crm/core";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { t } from "@/lib/i18n";
import { findNavItem } from "@/lib/navigation";
import { requireSession } from "@/lib/session";

/**
 * Página honesta para los módulos del menú que todavía no se construyeron. Dice en qué fase
 * llegan en lugar de mostrar datos falsos o botones sin backend.
 */
export async function PlannedModule({ path }: { path: string }) {
  const found = findNavItem(path);
  if (!found || found.item.plannedPhase == null) notFound();

  const { ctx } = await requireSession();
  if (!hasPermission(ctx, found.item.permission)) redirect("/forbidden");

  const title = t(found.item.label);
  return (
    <>
      <PageHeader title={title} description={found.item.description} />
      <Card>
        <EmptyState
          icon={Hammer}
          title={`Este módulo se construye en la Fase ${found.item.plannedPhase}`}
          description="Todavía no guarda ni muestra datos. Cuando esté disponible va a aparecer aquí, con los permisos de tu rol ya aplicados."
          action={
            <Button variant="secondary" asChild>
              <Link href="/dashboard">Volver al dashboard</Link>
            </Button>
          }
        />
      </Card>
    </>
  );
}
