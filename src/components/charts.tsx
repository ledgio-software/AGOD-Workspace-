import { cx } from "./ui";

// Small server-rendered charts (HTML + CSS, no chart library). They follow the dataviz rules used for
// this app: thin bars (<= 16px) with a 4px rounded data end, a 2px gap between stacked segments,
// recessive hairline grid, text in text colours (never the series colour), a legend for 2+ series, and
// a hover/focus tooltip on every mark. Every value is also in the table under each chart.

const PLOT = 176; // px height of the column plot

/** "GHS 12.5k" style label for axes, from minor units. */
export function compactMoney(minor: number, currency = "GHS") {
  const major = minor / 100;
  const abs = Math.abs(major);
  const sign = major < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${currency} ${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${sign}${currency} ${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return `${sign}${currency} ${Math.round(abs)}`;
}

/** A "nice" axis maximum (1, 2, 2.5 or 5 × 10^n) at or above `value`. */
function niceMax(value: number) {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * power >= value) return step * power;
  return 10 * power;
}

function Tooltip({ children, align = "center" }: { children: React.ReactNode; align?: "center" | "right" }) {
  return (
    <span
      role="tooltip"
      className={cx(
        "pointer-events-none absolute bottom-full z-10 mb-2 hidden w-max max-w-64 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg group-hover:block group-focus-visible:block",
        align === "center" ? "left-1/2 -translate-x-1/2" : "right-0",
      )}
    >
      {children}
    </span>
  );
}

export type BarItem = { key: string; label: string; value: number; display: string; note?: string };

/**
 * Horizontal bars for one measure (single series, so no legend: the card title names it). Handles
 * negative values with a zero baseline; an optional reference line (e.g. 100% capacity).
 */
export function BarList({
  items,
  reference,
  referenceLabel,
  max,
  negativeLabel,
}: {
  items: BarItem[];
  reference?: number;
  referenceLabel?: string;
  max?: number;
  negativeLabel?: string;
}) {
  const hi = Math.max(max ?? 0, reference ?? 0, ...items.map((i) => i.value), 0);
  const lo = Math.min(0, ...items.map((i) => i.value));
  const span = hi - lo || 1;
  const zero = (-lo / span) * 100;
  const pos = (v: number) => (Math.min(Math.max(v, lo), hi) - lo) / span * 100;

  return (
    <div className="space-y-2.5">
      {items.map((i) => {
        const negative = i.value < 0;
        const left = negative ? pos(i.value) : zero;
        const width = Math.abs(pos(i.value) - zero);
        return (
          <div
            key={i.key}
            tabIndex={0}
            aria-label={`${i.label}: ${i.display}${i.note ? `, ${i.note}` : ""}`}
            className="group grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 rounded-md text-sm outline-none sm:grid-cols-[minmax(0,12rem)_1fr_auto]"
          >
            <span className="truncate text-fg" title={i.label}>
              {i.label}
            </span>
            <span className="relative h-4">
              <span className="absolute inset-y-[7px] left-0 right-0 bg-line" aria-hidden />
              {lo < 0 && <span className="absolute inset-y-0 w-px bg-line-strong" style={{ left: `${zero}%` }} aria-hidden />}
              {reference !== undefined && (
                <span className="absolute -inset-y-1 w-px bg-muted/60" style={{ left: `${pos(reference)}%` }} aria-hidden />
              )}
              <span
                className={cx(
                  "absolute inset-y-0 transition group-hover:brightness-110 group-focus-visible:brightness-110",
                  negative ? "rounded-l-[4px] bg-negative" : "rounded-r-[4px] bg-series-1",
                )}
                style={{ left: `${left}%`, width: `${Math.max(width, i.value === 0 ? 0 : 0.75)}%` }}
                aria-hidden
              />
              <Tooltip>
                <span className="block font-semibold tabular-nums text-fg">{i.display}</span>
                <span className="block text-muted">
                  {i.label}
                  {i.note && ` · ${i.note}`}
                </span>
              </Tooltip>
            </span>
            <span className={cx("text-right tabular-nums", negative ? "font-medium text-red-600 dark:text-red-400" : "text-fg")}>{i.display}</span>
          </div>
        );
      })}
      {(reference !== undefined || lo < 0) && (
        <p className="flex flex-wrap gap-x-4 pt-1 text-xs text-muted">
          {reference !== undefined && (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-px bg-muted" aria-hidden /> {referenceLabel}
            </span>
          )}
          {lo < 0 && (
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-negative" aria-hidden /> {negativeLabel ?? "Below zero"}
            </span>
          )}
        </p>
      )}
    </div>
  );
}

export type Series = { key: string; label: string; className: string };
export type ColumnDatum = { key: string; label: string; values: Record<string, number>; fullLabel?: string };

/** Stacked columns over time, e.g. payouts per month. Legend above, axis labels in muted text. */
export function StackedColumns({
  series,
  data,
  format,
  axisFormat,
}: {
  series: Series[];
  data: ColumnDatum[];
  format: (v: number) => string;
  axisFormat: (v: number) => string;
}) {
  const totals = data.map((d) => series.reduce((s, x) => s + Math.max(0, d.values[x.key] ?? 0), 0));
  const top = niceMax(Math.max(...totals, 0));
  const ticks = [top, top / 2, 0];

  return (
    <div className="space-y-4">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legend">
        {series.map((s) => (
          <li key={s.key} className="inline-flex items-center gap-1.5">
            <span className={cx("size-2.5 rounded-sm", s.className)} aria-hidden />
            {s.label}
          </li>
        ))}
      </ul>
      <div className="flex gap-3">
        <div className="relative w-14 shrink-0 text-right text-[11px] tabular-nums text-muted" style={{ height: PLOT }} aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${(1 - t / top) * 100}%` }}>
              {axisFormat(t)}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative" style={{ height: PLOT }}>
            {ticks.map((t) => (
              <span key={t} className={cx("absolute inset-x-0 h-px", t === 0 ? "bg-line-strong" : "bg-line")} style={{ top: `${(1 - t / top) * 100}%` }} aria-hidden />
            ))}
            <div className="absolute inset-0 flex items-end justify-around">
              {data.map((d, idx) => {
                const total = totals[idx];
                const stack = series.filter((s) => (d.values[s.key] ?? 0) > 0);
                return (
                  <div
                    key={d.key}
                    tabIndex={0}
                    aria-label={`${d.fullLabel ?? d.label}: total ${format(total)}; ${series.map((s) => `${s.label} ${format(d.values[s.key] ?? 0)}`).join(", ")}`}
                    className="group relative flex h-full w-full max-w-24 flex-col items-center justify-end outline-none"
                  >
                    <span className="absolute inset-x-1 inset-y-0 rounded-md group-hover:bg-surface-muted group-focus-visible:bg-surface-muted" aria-hidden />
                    <div className="relative flex w-4 flex-col-reverse gap-[2px] sm:w-5" style={{ height: `${(total / top) * 100}%` }}>
                      {stack.map((s, i) => (
                        <span
                          key={s.key}
                          className={cx(s.className, i === stack.length - 1 && "rounded-t-[4px]")}
                          style={{ flexGrow: d.values[s.key], flexBasis: 0, minHeight: 2 }}
                          aria-hidden
                        />
                      ))}
                    </div>
                    <Tooltip>
                      <span className="block text-muted">{d.fullLabel ?? d.label}</span>
                      <span className="block font-semibold tabular-nums text-fg">{format(total)}</span>
                      {series.map((s) => (
                        <span key={s.key} className="mt-1 flex items-center justify-between gap-4">
                          <span className="inline-flex items-center gap-1.5 text-muted">
                            <span className={cx("h-0.5 w-3 rounded-full", s.className)} aria-hidden />
                            {s.label}
                          </span>
                          <span className="tabular-nums text-fg">{format(d.values[s.key] ?? 0)}</span>
                        </span>
                      ))}
                    </Tooltip>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="mt-2 flex justify-around text-xs text-muted" aria-hidden>
            {data.map((d) => (
              <span key={d.key} className="w-full max-w-24 text-center">
                {d.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
