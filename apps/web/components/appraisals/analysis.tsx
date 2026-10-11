import {
  APPRAISAL_VARIABLE_LABELS,
  type AppraisalResult,
  type AppraisalVariable,
} from "@crm/shared/appraisal";
import { formatMoney } from "@crm/shared/money";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Piezas de presentación del método metrológico (Matriz K, coeficientes, valores ajustados).
 * Sin estado: se usan en el editor y en el informe interno impreso.
 */

export type Currency = "USD" | "UYU";

const VARS: AppraisalVariable[] = ["m2", "construction", "location"];
const SHORT: Record<AppraisalVariable, string> = { m2: "M²", construction: "Constr.", location: "Ubic." };

export const fmtMoney = (n: number | null | undefined, c: Currency) =>
  n === null || n === undefined || !Number.isFinite(n)
    ? "—"
    : formatMoney({ amountMinor: BigInt(Math.round(n * 100)), currency: c }, { showDecimals: "never" });

export const fmtNum = (n: number | null | undefined, digits = 2) =>
  n === null || n === undefined || !Number.isFinite(n)
    ? "—"
    : n.toLocaleString("es-UY", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const fmtPct = (n: number | null | undefined, digits = 2) =>
  n === null || n === undefined ? "—" : `${fmtNum(n * 100, digits)} %`;

export const unitLabelOf = (c: Currency) => (c === "USD" ? "US$/m²" : "$/m²");

/** Fila de la Matriz K: constante + una K por variable. */
export function matrixKEntries(r: AppraisalResult): { label: string; key: string; value: number | null }[] {
  return [
    { key: "K0", label: "Constante", value: r.k?.constant ?? null },
    { key: "K1", label: "M²", value: r.k?.m2 ?? null },
    { key: "K2", label: "Construcción", value: r.k?.construction ?? null },
    { key: "K3", label: "Ubicación", value: r.k?.location ?? null },
  ];
}

export function warningText(r: AppraisalResult): string[] {
  return r.warnings.map((w) => {
    const v = APPRAISAL_VARIABLE_LABELS[w.variable].toLowerCase();
    const cause =
      w.cause !== null ? ` Revisá el antecedente A${w.cause + 1}: su ${v} no se condice con su precio.` : "";
    return `K de ${v} negativo: en la muestra, mejor ${v} da menor precio, lo cual es incongruente.${cause}`;
  });
}

export function MatrixKTable({ result, compact }: { result: AppraisalResult; compact?: boolean }) {
  const entries = matrixKEntries(result);
  return (
    <div className={cn("grid gap-2", compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4")}>
      {entries.map((e) => (
        <div key={e.key} className="rounded-md border bg-surface px-3 py-2">
          <p className="text-[11px] text-muted-foreground">
            {e.key} · {e.label}
          </p>
          <p
            className={cn(
              "font-semibold tabular",
              compact ? "text-sm" : "text-base",
              e.value !== null && e.value < 0 && "text-danger",
              e.value === null && "text-muted-foreground",
            )}
          >
            {e.value === null ? "—" : fmtNum(e.value)}
          </p>
        </div>
      ))}
    </div>
  );
}

export function WarningsBox({ result }: { result: AppraisalResult }) {
  const texts = warningText(result);
  if (!texts.length) return null;
  return (
    <div className="grid gap-1.5 rounded-md border border-danger/40 bg-danger-soft p-3 text-sm text-danger">
      {texts.map((t) => (
        <p key={t} className="flex gap-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{t}</span>
        </p>
      ))}
    </div>
  );
}

export function CoefficientCards({ result, currency }: { result: AppraisalResult; currency: Currency }) {
  const valid = result.rows.filter((r) => r.valid && r.coefficient !== null);
  if (!valid.length) return <p className="text-sm text-muted-foreground">Sin antecedentes válidos.</p>;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {valid.map((r) => (
        <div key={r.index} className="rounded-lg border bg-surface p-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-semibold">A{r.index + 1}</span>
            <span className="text-xs text-muted-foreground">
              C ={" "}
              <span className="text-base font-semibold text-foreground tabular">
                {fmtNum(r.coefficient, 4)}
              </span>
            </span>
          </div>
          <dl className="mt-2 grid grid-cols-3 gap-1 text-center text-xs">
            {VARS.map((v) => {
              const f = r.factors?.[v] ?? 1;
              return (
                <div key={v} className="rounded bg-surface-muted px-1 py-1.5">
                  <dt className="text-muted-foreground" title={APPRAISAL_VARIABLE_LABELS[v]}>
                    {SHORT[v]}
                  </dt>
                  <dd
                    className={cn("font-medium tabular", f < 1 ? "text-danger" : f > 1 ? "text-success" : "")}
                  >
                    {fmtNum(f, 4)}
                  </dd>
                </div>
              );
            })}
          </dl>
          <p className="mt-2 flex justify-between text-xs text-muted-foreground">
            <span>{fmtMoney(r.value, currency)}</span>
            <span>→</span>
            <span className="font-medium text-foreground">{fmtMoney(r.adjusted, currency)}</span>
          </p>
        </div>
      ))}
    </div>
  );
}

export function AdjustedBars({ result, currency }: { result: AppraisalResult; currency: Currency }) {
  const valid = result.rows.filter((r) => r.valid && r.adjusted !== null);
  if (!valid.length) return null;
  // Escala desde un poco por debajo del mínimo para que se aprecien las diferencias.
  const vals = valid.map((r) => r.adjusted as number);
  const hi = Math.max(...vals, result.max ?? 0);
  const lo = Math.min(...vals, result.min ?? Infinity);
  const base = Math.max(0, lo - (hi - lo) * 0.5 - hi * 0.01);
  const pos = (x: number) => `${Math.max(2, Math.min(100, ((x - base) / (hi - base)) * 100))}%`;
  return (
    <div className="grid gap-2">
      {valid.map((r) => (
        <div key={r.index} className="grid grid-cols-[2.5rem_minmax(0,1fr)_7rem] items-center gap-3 text-sm">
          <span className="font-medium text-muted-foreground">A{r.index + 1}</span>
          <div className="relative h-5 rounded bg-surface-muted">
            <div className="h-5 rounded bg-primary/70" style={{ width: pos(r.adjusted as number) }} />
            {result.probable !== null && (
              <div
                className="absolute inset-y-[-3px] w-0.5 bg-foreground"
                style={{ left: pos(result.probable) }}
                title="Valor probable"
              />
            )}
          </div>
          <span className="text-right tabular">{fmtMoney(r.adjusted, currency)}</span>
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        La línea vertical marca el valor probable (promedio). Escala ampliada para ver las diferencias.
      </p>
    </div>
  );
}

export function SummaryCards({ result, currency }: { result: AppraisalResult; currency: Currency }) {
  const cells: [string, number | null, boolean][] = [
    ["Valor mínimo", result.min, false],
    ["Valor probable", result.probable, true],
    ["Valor máximo", result.max, false],
  ];
  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        {cells.map(([label, value, main]) => (
          <div
            key={label}
            className={cn(
              "rounded-lg border p-4 text-center",
              main ? "border-primary bg-primary-soft" : "bg-surface",
            )}
          >
            <p className="text-xs text-muted-foreground">{label}</p>
            <p
              className={cn(
                "font-semibold tracking-tight tabular",
                main ? "text-2xl text-primary" : "text-xl",
              )}
            >
              {fmtMoney(value, currency)}
            </p>
          </div>
        ))}
      </div>
      <dl className="grid grid-cols-3 gap-3 text-center text-sm">
        <div className="rounded-md bg-surface-muted p-2">
          <dt className="text-xs text-muted-foreground">Desv. estándar</dt>
          <dd className="font-medium tabular">{fmtMoney(result.stdDev, currency)}</dd>
        </div>
        <div className="rounded-md bg-surface-muted p-2">
          <dt className="text-xs text-muted-foreground">Incertidumbre</dt>
          <dd className="font-medium tabular">± {fmtPct(result.uncertainty)}</dd>
        </div>
        <div className="rounded-md bg-surface-muted p-2">
          <dt className="text-xs text-muted-foreground">Confianza</dt>
          <dd className="font-medium tabular">{fmtPct(result.confidence, 0)}</dd>
        </div>
      </dl>
    </div>
  );
}
