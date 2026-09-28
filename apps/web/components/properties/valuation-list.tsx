import { VALUATION_METHOD_LABELS, type Currency, type ValuationMethod } from "@crm/shared";
import { Scale } from "lucide-react";
import { EmptyState } from "@/components/ui/misc";
import { formatDay, price } from "./format";

export interface ValuationView {
  id: string;
  method: ValuationMethod;
  currency: Currency;
  valueMinor: bigint;
  minMinor: bigint | null;
  maxMinor: bigint | null;
  valuedAt: string;
  valuedBy: string | null;
  notes: string | null;
  comparables: { address: string; priceMinor: string | null; areaM2: string | null; url: string | null }[];
}

export function ValuationList({ items }: { items: ValuationView[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={Scale}
        title="Sin tasaciones"
        description="Registrá el valor estimado con sus comparables."
        className="py-8"
      />
    );
  }
  return (
    <ul className="divide-y">
      {items.map((v, i) => (
        <li key={v.id} className="grid gap-1 px-4 py-3 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p>
              <strong className="text-base tabular">{price(v.valueMinor, v.currency)}</strong>
              {(v.minMinor !== null || v.maxMinor !== null) && (
                <span className="ml-2 text-muted-foreground tabular">
                  ({price(v.minMinor, v.currency)} – {price(v.maxMinor, v.currency)})
                </span>
              )}
              {i === 0 && items.length > 1 && <span className="ml-2 text-xs text-primary">Más reciente</span>}
            </p>
            <p className="text-xs text-muted-foreground">
              {VALUATION_METHOD_LABELS[v.method]} · {formatDay(v.valuedAt)} · {v.valuedBy ?? "—"}
            </p>
          </div>
          {v.notes && <p className="whitespace-pre-wrap text-muted-foreground">{v.notes}</p>}
          {v.comparables.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">
                {v.comparables.length} comparable(s)
              </summary>
              <ul className="mt-1 grid gap-0.5">
                {v.comparables.map((c, j) => (
                  <li key={j}>
                    {c.url ? (
                      <a href={c.url} target="_blank" rel="noreferrer noopener" className="hover:underline">
                        {c.address}
                      </a>
                    ) : (
                      c.address
                    )}
                    {" · "}
                    <span className="tabular">{c.priceMinor ? price(c.priceMinor, v.currency) : "—"}</span>
                    {c.areaM2 ? ` · ${c.areaM2} m²` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}
