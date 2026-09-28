import { careerStatus } from "@crm/core";
import { getDb } from "@crm/db";
import { CheckCircle2, Circle, Trophy } from "lucide-react";
import type { Metadata } from "next";
import { PlanEditorButton } from "@/components/deals/plan-editor";
import { minorToInput, price } from "@/components/properties/format";
import { Badge, Card, PageHeader } from "@/components/ui/misc";
import { requirePagePermission } from "@/lib/session";
import { cn, initials } from "@/lib/utils";

export const metadata: Metadata = { title: "Mi carrera" };

export default async function CareerPage() {
  const { ctx, user } = await requirePagePermission("commission.read");
  const s = await careerStatus(getDb(), ctx);
  const { tiers } = s.plan;
  const progress =
    s.next && s.tier
      ? Number(
          ((s.billedUsdMinor - s.tier.minBilledUsdMinor) * 1000n) /
            (s.next.minBilledUsdMinor - s.tier.minBilledUsdMinor || 1n),
        ) / 10
      : 100;

  return (
    <>
      <PageHeader
        title="Mi carrera"
        description="Tu porcentaje de comisión sube a medida que crece tu facturación acumulada."
        actions={
          s.canEditPlan ? (
            <PlanEditorButton
              uyuPerUsd={s.plan.uyuPerUsd}
              tiers={tiers.map((t) => ({
                name: t.name,
                minBilled: minorToInput(t.minBilledUsdMinor),
                rate: String(t.rateBasisPoints / 100).replace(".", ","),
              }))}
            />
          ) : undefined
        }
      />
      {!s.plan.configured && (
        <p className="mb-4 rounded-md border border-warning/50 bg-warning-soft/50 px-4 py-2 text-sm">
          Estos escalones son un ejemplo.{" "}
          {s.canEditPlan
            ? "Configurá los de tu inmobiliaria."
            : "La administración todavía no configuró el plan."}
        </p>
      )}

      <Card className="mb-5 flex flex-wrap items-center gap-5 bg-gradient-to-br from-primary-soft via-surface to-surface p-5">
        <span className="flex size-14 items-center justify-center rounded-full bg-primary text-lg font-bold text-primary-foreground">
          {initials(user.name)}
        </span>
        <div>
          <p className="text-lg font-semibold">{user.name}</p>
          <Badge tone="primary">{s.tier?.name}</Badge>
        </div>
        <dl className="ml-auto grid grid-cols-2 gap-6 text-right">
          <div>
            <dt className="text-xs text-muted-foreground">Comisión actual</dt>
            <dd className="text-2xl font-bold text-primary tabular">
              {(s.tier?.rateBasisPoints ?? 0) / 100} %
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Facturación acumulada</dt>
            <dd className="text-2xl font-bold tabular">{price(s.billedUsdMinor, "USD")}</dd>
          </div>
        </dl>
      </Card>

      {s.next && (
        <Card className="mb-5 p-5">
          <p className="text-sm">
            Te faltan <strong className="tabular">{price(s.remainingUsdMinor, "USD")}</strong> para llegar a{" "}
            <strong>{s.next.name}</strong> ({s.next.rateBasisPoints / 100} %).
          </p>
          <div
            className="mt-3 h-2.5 overflow-hidden rounded-full bg-surface-muted"
            role="progressbar"
            aria-valuenow={Math.round(progress)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Progreso hacia ${s.next.name}`}
          >
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.max(2, Math.min(100, progress))}%` }}
            />
          </div>
        </Card>
      )}

      <Card>
        <h2 className="flex items-center gap-2 border-b px-4 py-3 text-sm font-semibold">
          <Trophy className="size-4 text-primary" aria-hidden /> Escalones
        </h2>
        <ol className="divide-y">
          {tiers.map((t, i) => {
            const reached = i <= s.tierIndex;
            return (
              <li
                key={t.name}
                className={cn("flex items-center gap-3 px-4 py-3", i === s.tierIndex && "bg-primary-soft/50")}
              >
                {reached ? (
                  <CheckCircle2 className="size-5 text-primary" aria-label="Alcanzado" />
                ) : (
                  <Circle className="size-5 text-muted-foreground" aria-label="Pendiente" />
                )}
                <span className="flex-1">
                  <span className="font-medium">{t.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t.minBilledUsdMinor === 0n
                      ? "Desde el inicio"
                      : `Desde ${price(t.minBilledUsdMinor, "USD")}`}
                  </span>
                </span>
                <span className="text-lg font-bold tabular">{t.rateBasisPoints / 100} %</span>
              </li>
            );
          })}
        </ol>
        <p className="border-t px-4 py-2 text-xs text-muted-foreground">
          La facturación suma tu parte de los honorarios cobrados; los pesos se convierten a{" "}
          {s.plan.uyuPerUsd} por dólar. El porcentaje de cada operación queda fijo al cerrarla.
        </p>
      </Card>
    </>
  );
}
