import { competition } from "@crm/core";
import { getDb } from "@crm/db";
import { POINT_RULE_LABELS, POINT_RULES } from "@crm/shared";
import { Medal, Trophy } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { requirePagePermission } from "@/lib/session";
import { DEFAULT_TZ, ymdInTz } from "@/lib/tz";
import { cn, initials } from "@/lib/utils";

export const metadata: Metadata = { title: "Competencia" };

const pts = (n: number) => n.toLocaleString("es-UY", { maximumFractionDigits: 1 });

export default async function RankingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { ctx } = await requirePagePermission("dashboard.read");
  const params = await searchParams;
  const year = Number(ymdInTz(new Date(), ctx.organization.timezone || DEFAULT_TZ).slice(0, 4));
  const tab = params.tab === "branches" ? "branches" : "agents";
  const r = await competition(getDb(), ctx, { year });
  const rows = tab === "agents" ? r.agents : r.branches;
  const top = rows.slice(0, 3);

  return (
    <>
      <PageHeader title="Competencia" description={`Temporada ${year} · ${r.agents.length} participantes`} />

      <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
        <Card className="p-5">
          <p className="text-sm text-muted-foreground">Mis puntos {year}</p>
          <p className="mt-1 flex items-center gap-2 text-4xl font-bold tabular">
            <Trophy className="size-7 text-primary" aria-hidden /> {pts(r.me?.points ?? 0)}
          </p>
          {r.me && (
            <p className="mt-1 text-sm text-muted-foreground">
              #{r.me.position} de {r.agents.length}
              {r.toPodium > 0 && ` · te faltan ${pts(r.toPodium)} para el podio`}
            </p>
          )}
          <h2 className="mt-5 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Últimos movimientos
          </h2>
          {r.myMovements.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Todavía no sumaste puntos esta temporada.</p>
          ) : (
            <ul className="mt-2 divide-y text-sm">
              {r.myMovements.map((m, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate">{POINT_RULE_LABELS[m.kind]}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {m.at.slice(0, 10).split("-").reverse().join("/")} · {m.label}
                    </span>
                  </span>
                  <span className="shrink-0 font-semibold text-success tabular">+{pts(m.points)} pts</span>
                </li>
              ))}
            </ul>
          )}
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-primary">¿Cómo se suman los puntos?</summary>
            <ul className="mt-2 grid gap-1 text-muted-foreground">
              {Object.entries(POINT_RULES).map(([k, v]) => (
                <li key={k} className="flex justify-between">
                  <span>{POINT_RULE_LABELS[k as keyof typeof POINT_RULES]}</span>
                  <span className="tabular">{v} pts</span>
                </li>
              ))}
              <li className="text-xs">
                En operaciones compartidas los puntos se reparten según el % de cada agente.
              </li>
            </ul>
          </details>
        </Card>

        <div>
          <nav aria-label="Ranking" className="mb-4 flex gap-4 border-b text-sm">
            {[
              { k: "agents", l: "Agentes" },
              { k: "branches", l: "Sucursales" },
            ].map((t) => (
              <Link
                key={t.k}
                href={`?tab=${t.k}`}
                className={cn(
                  "-mb-px border-b-2 py-2",
                  tab === t.k ? "border-primary font-medium" : "border-transparent text-muted-foreground",
                )}
              >
                {t.l}
              </Link>
            ))}
          </nav>

          {rows.length === 0 ? (
            <Card>
              <EmptyState
                icon={Medal}
                title="Sin puntos todavía"
                description="El ranking se arma con la actividad del año."
              />
            </Card>
          ) : (
            <>
              <div className="mb-4 grid grid-cols-3 items-end gap-3" aria-label="Podio">
                {[top[1], top[0], top[2]].map((t, i) =>
                  t ? (
                    <div key={i} className="text-center">
                      <span
                        className={cn(
                          "mx-auto mb-2 flex items-center justify-center rounded-full bg-primary font-bold text-primary-foreground",
                          i === 1 ? "size-14 text-lg" : "size-11",
                        )}
                      >
                        {initials(t.name)}
                      </span>
                      <p className="truncate text-sm font-medium">{t.name}</p>
                      <p className="text-xs text-muted-foreground tabular">{pts(t.points)} pts</p>
                      <div
                        className={cn(
                          "mt-2 flex items-start justify-center rounded-t-lg border-x border-t pt-2 text-lg font-bold",
                          i === 1
                            ? "h-20 bg-primary-soft text-primary"
                            : i === 0
                              ? "h-14 bg-surface-muted"
                              : "h-10 bg-surface-muted",
                        )}
                      >
                        #{t.position}
                      </div>
                    </div>
                  ) : (
                    <div key={i} />
                  ),
                )}
              </div>
              <Card>
                <ol className="divide-y">
                  {rows.map((row) => {
                    const isMe = "userId" in row && row.userId === ctx.userId;
                    return (
                      <li
                        key={"userId" in row ? row.userId : row.branchId}
                        className={cn("flex items-center gap-3 px-4 py-3", isMe && "bg-primary-soft/50")}
                      >
                        <span className="w-8 text-lg font-bold text-muted-foreground tabular">
                          #{row.position}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">
                            {row.name} {isMe && <Badge tone="primary">Vos</Badge>}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {"branchName" in row ? (row.branchName ?? "—") : `${row.agents} agentes`}
                          </span>
                        </span>
                        <Badge tone="warning" className="tabular">
                          {pts(row.points)} pts
                        </Badge>
                      </li>
                    );
                  })}
                </ol>
              </Card>
            </>
          )}
        </div>
      </div>
    </>
  );
}
