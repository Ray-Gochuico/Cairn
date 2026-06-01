import type { CSSProperties, ReactNode } from 'react';

interface StatTileProps {
  label: ReactNode;
  value: ReactNode;
  /** Forwarded to `data-testid` on the outer container for scoped queries. */
  testId?: string;
  /** Extra Tailwind classes applied to the value (e.g. `text-success-foreground`). */
  valueClassName?: string;
  /** Inline style applied to the value (use for CSS vars without a Tailwind class). */
  valueStyle?: CSSProperties;
}

/**
 * Canonical metric-strip tile: `rounded-md border bg-muted/40 p-3` outer,
 * `text-xs text-muted-foreground` label over a `tabular-nums font-semibold`
 * value. Replaces the three slightly-drifted hand-rolled variants in
 * CompoundInterest, DebtPayoff, and Retirement401kWithdrawal.
 *
 * `valueClassName` / `valueStyle` support the coloured variants:
 *   - `valueClassName="text-success-foreground"` for best-ending green.
 *   - `valueStyle={{ color: 'hsl(var(--chart-danger))' }}` for worst-ending
 *     (no `text-chart-danger` Tailwind utility exists).
 */
export function StatTile({
  label,
  value,
  testId,
  valueClassName = '',
  valueStyle,
}: StatTileProps) {
  return (
    <div
      data-testid={testId}
      className="rounded-md border bg-muted/40 p-3"
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`text-base font-semibold tabular-nums ${valueClassName}`.trim()}
        style={valueStyle}
      >
        {value}
      </div>
    </div>
  );
}
