import { price } from "@/components/properties/format";

const MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Set", "Oct", "Nov", "Dic"];

/**
 * Barras mensuales de una sola moneda (una serie, un eje). Cada barra lleva su valor en el
 * tooltip nativo y en texto accesible; los meses sin cobros quedan en la línea base.
 */
export function MonthlyBars({
  title,
  currency,
  data,
}: {
  title: string;
  currency: "USD" | "UYU";
  data: { month: string; amountMinor: bigint }[];
}) {
  const max = data.reduce((m, d) => (d.amountMinor > m ? d.amountMinor : m), 0n);
  const total = data.reduce((a, d) => a + d.amountMinor, 0n);
  const active = data.filter((d) => d.amountMinor > 0n);
  const best = active.reduce<(typeof data)[number] | null>(
    (b, d) => (!b || d.amountMinor > b.amountMinor ? d : b),
    null,
  );
  const label = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;

  return (
    <figure className="p-4">
      <figcaption className="mb-3 flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-xs text-muted-foreground">últimos 12 meses</span>
      </figcaption>
      <div className="flex h-36 items-end gap-1.5 border-b border-border" role="list" aria-label={title}>
        {data.map((d) => {
          const pct = max > 0n ? Number((d.amountMinor * 1000n) / max) / 10 : 0;
          return (
            <div
              key={d.month}
              role="listitem"
              className="group relative flex h-full flex-1 flex-col justify-end"
              title={`${label(d.month)}: ${price(d.amountMinor, currency)}`}
            >
              <span className="sr-only">
                {label(d.month)}: {price(d.amountMinor, currency)}
              </span>
              <span
                className="block w-full rounded-t-[4px] bg-primary transition-opacity group-hover:opacity-80"
                style={{ height: d.amountMinor > 0n ? `max(${pct}%, 3px)` : "0" }}
                aria-hidden
              />
              <span className="pointer-events-none absolute -top-6 left-1/2 hidden -translate-x-1/2 rounded bg-foreground px-1.5 py-0.5 text-[10px] whitespace-nowrap text-background group-hover:block">
                {price(d.amountMinor, currency)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1.5 text-center text-[10px] text-muted-foreground">
        {data.map((d) => (
          <span key={d.month} className="flex-1 truncate">
            {label(d.month).slice(0, 3)}
          </span>
        ))}
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground uppercase">Total</dt>
          <dd className="font-semibold tabular">{price(total, currency)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground uppercase">Mejor mes</dt>
          <dd className="font-semibold">{best ? label(best.month) : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground uppercase">Promedio</dt>
          <dd className="font-semibold tabular">
            {active.length ? price(total / BigInt(active.length), currency) : "—"}
          </dd>
          <dd className="text-xs text-muted-foreground">{active.length} meses con cobros</dd>
        </div>
      </dl>
    </figure>
  );
}
