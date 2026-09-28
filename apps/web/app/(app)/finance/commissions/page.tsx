import { agentFinance, hasPermission, listDealUsers } from "@crm/core";
import { getDb } from "@crm/db";
import { COMMISSION_STATUS_LABELS, PROPERTY_OPERATION_LABELS } from "@crm/shared";
import { Clock, DollarSign, Hourglass, TrendingUp, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { MonthlyBars } from "@/components/deals/monthly-bars";
import { formatDay, price } from "@/components/properties/format";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requirePagePermission } from "@/lib/session";
import { DEFAULT_TZ, ymdInTz } from "@/lib/tz";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Finanzas" };

function both(v: { USD: bigint; UYU: bigint }) {
  const parts = [v.USD > 0n && price(v.USD, "USD"), v.UYU > 0n && price(v.UYU, "UYU")].filter(Boolean);
  return parts.length ? parts.join(" · ") : "—";
}

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { ctx, user } = await requirePagePermission("commission.read");
  const params = await searchParams;
  const db = getDb();
  const tz = ctx.organization.timezone || DEFAULT_TZ;
  const today = ymdInTz(new Date(), tz);
  // Quien ve comisiones de otros (gerentes, contabilidad) puede elegir el agente.
  const others = hasPermission(ctx, "commission.read", {
    organizationId: ctx.organizationId,
    ownerUserId: null,
    branchId: null,
    teamId: null,
  });
  const users = others ? await listDealUsers(db, ctx) : [];
  const userId = others && params.user ? params.user : ctx.userId;
  const f = await agentFinance(db, ctx, { userId, today });
  const who = users.find((u) => u.userId === userId)?.name ?? user.name;

  const tiles = [
    { label: "Cobrado este mes", value: both(f.collectedMonth), icon: DollarSign },
    {
      label: `Cobrado en ${today.slice(0, 4)}`,
      value: both(f.collectedYear),
      sub: `${f.collectedYearCount} ${f.collectedYearCount === 1 ? "operación" : "operaciones"}`,
      icon: TrendingUp,
    },
    {
      label: "Pendiente de cobro",
      value: both(f.pending),
      icon: Hourglass,
      sub: f.pending.USD || f.pending.UYU ? undefined : "Estás al día",
    },
    {
      label: "Próxima cobranza",
      value: f.nextDue ? price(f.nextDue.amountMinor, f.nextDue.currency) : "—",
      sub: f.nextDue
        ? `${f.nextDue.dealCode}${f.nextDue.date ? ` · ${formatDay(f.nextDue.date)}` : ""}`
        : undefined,
      icon: Clock,
    },
  ];

  return (
    <>
      <PageHeader
        title="Finanzas"
        description={`Lo que le corresponde a ${userId === ctx.userId ? "vos" : who} de cada honorario: su parte del reparto × el porcentaje de su escalón.`}
      />

      {others && (
        <nav aria-label="Agente" className="mb-4 flex flex-wrap gap-1.5 text-xs">
          {users.map((u) => (
            <Link
              key={u.userId}
              href={`?user=${u.userId}`}
              className={cn(
                "rounded-full border px-3 py-1",
                u.userId === userId ? "border-primary bg-primary-soft text-primary" : "text-muted-foreground",
              )}
            >
              {u.name}
            </Link>
          ))}
        </nav>
      )}

      <Card className="mb-5 flex flex-wrap items-center gap-6 bg-gradient-to-br from-primary-soft via-surface to-surface p-5">
        <div className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Wallet className="size-5" aria-hidden />
          </span>
          <div>
            <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              Mi billetera
            </p>
            <p className="font-semibold">{who}</p>
          </div>
        </div>
        <dl className="ml-auto grid grid-cols-3 gap-6 text-right">
          <div>
            <dt className="text-xs text-muted-foreground">Cobrado USD</dt>
            <dd className="text-lg font-bold tabular">{price(f.collectedTotal.USD, "USD")}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Cobrado UYU</dt>
            <dd className="text-lg font-bold tabular">{price(f.collectedTotal.UYU, "UYU")}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Tu porcentaje hoy</dt>
            <dd className="text-lg font-bold tabular">{f.currentRateBasisPoints / 100} %</dd>
          </div>
        </dl>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map(({ label, value, sub, icon: Icon }) => (
          <Card key={label} className="rounded-xl p-4">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              {label}
              <Icon className="size-4" aria-hidden />
            </div>
            <p className="mt-2 text-xl font-bold tabular">{value}</p>
            {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
          </Card>
        ))}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <MonthlyBars
            title="Cobrado en dólares"
            currency="USD"
            data={f.monthly.map((m) => ({ month: m.month, amountMinor: m.USD }))}
          />
        </Card>
        <Card>
          <MonthlyBars
            title="Cobrado en pesos"
            currency="UYU"
            data={f.monthly.map((m) => ({ month: m.month, amountMinor: m.UYU }))}
          />
        </Card>
      </div>

      <Card className="mt-5">
        <h2 className="border-b px-4 py-3 text-sm font-semibold">Comisiones por operación</h2>
        {f.lines.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title="Todavía no hay comisiones"
            description="Aparecen cuando participás en una operación con honorarios cargados."
          />
        ) : (
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Operación</TH>
                <TH className="hidden sm:table-cell">Tipo</TH>
                <TH className="text-right">Te corresponde</TH>
                <TH>Estado</TH>
                <TH className="hidden md:table-cell text-right">Fecha</TH>
              </TR>
            </THead>
            <TBody>
              {f.lines.map((l) => (
                <TR key={l.id}>
                  <TD className="max-w-0 sm:max-w-none">
                    <Link
                      href={`/commercial/deals/${l.dealId}`}
                      className="block truncate font-medium hover:underline"
                    >
                      {l.title}
                    </Link>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      <span className="font-mono text-xs text-muted-foreground">{l.dealCode}</span>
                      {l.teamWork && <Badge tone="primary">Trabajada en equipo</Badge>}
                      {l.bothSides && <Badge tone="outline">Cobrás de ambas partes</Badge>}
                    </div>
                  </TD>
                  <TD className="hidden sm:table-cell">
                    <Badge>{PROPERTY_OPERATION_LABELS[l.operation]}</Badge>
                  </TD>
                  <TD className="text-right font-semibold tabular">{price(l.amountMinor, l.currency)}</TD>
                  <TD>
                    <Badge tone={l.status === "collected" ? "success" : "warning"}>
                      {COMMISSION_STATUS_LABELS[l.status]}
                    </Badge>
                  </TD>
                  <TD className="hidden text-right text-muted-foreground tabular md:table-cell">
                    {formatDay(l.date)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
