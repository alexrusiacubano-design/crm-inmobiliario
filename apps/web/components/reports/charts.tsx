import { monthLabel } from "@crm/shared/reports";

/**
 * Columnas por mes (una sola serie: el título del bloque la nombra). Tooltip nativo en cada
 * columna; se rotula solo el máximo y el último mes.
 */
export function MonthlyBars({ data, label }: { data: { ym: string; value: number }[]; label: string }) {
  const W = 600;
  const H = 160;
  const padB = 22;
  const padT = 18;
  const max = Math.max(1, ...data.map((d) => d.value));
  const slot = W / data.length;
  const bw = Math.max(6, slot - 8);
  const maxIdx = data.findIndex((d) => d.value === max);
  return (
    <figure className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-44 w-full" role="img" aria-label={label}>
        <line x1={0} x2={W} y1={H - padB} y2={H - padB} className="stroke-border" strokeWidth={1} />
        {data.map((d, i) => {
          const h = ((H - padB - padT) * d.value) / max;
          const x = i * slot + (slot - bw) / 2;
          const y = H - padB - h;
          const showValue = d.value > 0 && (i === maxIdx || i === data.length - 1);
          return (
            <g key={d.ym}>
              <title>{`${monthLabel(d.ym)}: ${d.value}`}</title>
              <rect x={i * slot} y={0} width={slot} height={H} fill="transparent" />
              {h > 0 && (
                <path
                  d={`M${x},${H - padB} V${y + Math.min(4, h)} Q${x},${y} ${x + Math.min(4, bw / 2)},${y} H${x + bw - Math.min(4, bw / 2)} Q${x + bw},${y} ${x + bw},${y + Math.min(4, h)} V${H - padB} Z`}
                  className="fill-primary"
                />
              )}
              {showValue && (
                <text
                  x={x + bw / 2}
                  y={y - 5}
                  textAnchor="middle"
                  className="fill-foreground text-[11px] font-medium"
                >
                  {d.value}
                </text>
              )}
              <text
                x={i * slot + slot / 2}
                y={H - 6}
                textAnchor="middle"
                className="fill-muted-foreground text-[10px]"
              >
                {monthLabel(d.ym).split(" ")[0]}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="sr-only">
        {data.map((d) => `${monthLabel(d.ym)}: ${d.value}`).join(", ")}
      </figcaption>
    </figure>
  );
}

/** Barras horizontales (embudo, motivos): etiqueta y valor en texto, barra como apoyo. */
export function HBars({ rows }: { rows: { label: string; value: number; note?: string | null }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="grid gap-2">
      {rows.map((r) => (
        <li
          key={r.label}
          className="grid grid-cols-[8rem_1fr_auto] items-center gap-3 text-sm sm:grid-cols-[10rem_1fr_auto]"
        >
          <span className="truncate text-muted-foreground" title={r.label}>
            {r.label}
          </span>
          <span className="h-3 overflow-hidden rounded-r bg-surface-muted" title={`${r.label}: ${r.value}`}>
            <span
              className="block h-full rounded-r bg-primary"
              style={{ width: `${(r.value / max) * 100}%` }}
            />
          </span>
          <span className="text-right tabular">
            <span className="font-medium">{r.value}</span>
            {r.note && <span className="ml-1.5 text-xs text-muted-foreground">{r.note}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Kpi({ label, value, hint }: { label: string; value: string; hint?: string | null }) {
  return (
    <div className="rounded-lg border bg-surface p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
