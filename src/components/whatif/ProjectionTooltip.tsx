import React from 'react';
import type { Scenario } from '@/types/scenario';
import type { MonthlyState } from '@/lib/scenarios';
import { formatCurrency } from '@/lib/format';

/**
 * Task #25 — decomposed projection-chart tooltip.
 *
 * Replaces the previous single-line "$X,XXX,XXX  net worth" tooltip with a
 * per-scenario breakdown of the net change month-over-month:
 *
 *   Scenario: Baseline
 *   Net worth: $1,200,000
 *   Net change vs prev month: +$11,500
 *     · Compound return: +$4,200
 *     · Auto-invested salary: +$7,300
 *     · Lever contributions: +$0
 *     · Lump sums: +$0
 *     · Withdrawals: −$0
 *
 * Zero-valued decomposition rows are OMITTED for cleanliness. The "auto-
 * invested salary" line is the dominant term in early-accumulation years
 * (see docs/superpowers/specs/2026-05-26-current-state.md §99-117) — making
 * it visible is the whole point of T25.
 *
 * Exported as a named function so tests can call it directly with a
 * synthetic payload, sidestepping the brittle recharts-tooltip-in-jsdom path.
 */

export interface DecomposedTooltipContentProps {
  label?: string | number;
  active?: boolean;
  /** Visible scenarios (matched against per-row payload to know which to render). */
  scenarios: Scenario[];
  /** Display-mode projections, keyed by scenario id. Same map ProjectionChart already uses. */
  displayProjections: Map<number, MonthlyState[]>;
}

interface DecompRow {
  label: string;
  value: number;
  /** Sign convention for display: 'in' renders +$X, 'out' renders -$X. */
  direction: 'in' | 'out';
}

/**
 * Build the per-scenario decomposition rows for the given step. Rows with
 * zero values are filtered out by the caller (we return the full list here
 * to keep this function deterministic and unit-testable).
 */
export function decomposeStep(state: MonthlyState): DecompRow[] {
  return [
    { label: 'Compound return', value: state.compoundReturnAdded ?? 0, direction: 'in' },
    { label: 'Auto-invested salary', value: state.autoInvestedSalarySurplus ?? 0, direction: 'in' },
    // Task β2 — surfaces the salary surplus that the engine routed to cash
    // (migration 0029, auto-invest OFF path). The engine guarantees this
    // field and `autoInvestedSalarySurplus` are mutually exclusive per step,
    // so the user sees one or the other (or neither) — not both.
    { label: 'Surplus to cash', value: state.salarySurplusToCash ?? 0, direction: 'in' },
    { label: 'Lever contributions', value: state.leverContributionsInvested ?? 0, direction: 'in' },
    { label: 'Lump sums', value: state.lumpSumInvested ?? 0, direction: 'in' },
    { label: 'Withdrawals', value: state.withdrawnFromInvestments ?? 0, direction: 'out' },
  ];
}

/**
 * Find the index of the MonthlyState whose `monthISO` matches `label`. Returns
 * -1 when not found. Linear scan — projections are small enough (≤ 480 steps).
 */
function findStateIndex(states: MonthlyState[], monthISO: string | undefined): number {
  if (!monthISO) return -1;
  for (let i = 0; i < states.length; i++) {
    if (states[i].monthISO === monthISO) return i;
  }
  return -1;
}

function formatSigned(value: number, direction: 'in' | 'out'): string {
  if (value === 0) return formatCurrency(0);
  // 'in' renders positive values as "+$X" and negative (rare) as "-$X".
  // 'out' renders any non-zero withdrawal as "-$X" (display sign convention).
  if (direction === 'out') {
    return '−' + formatCurrency(Math.abs(value));
  }
  const sign = value >= 0 ? '+' : '−';
  return sign + formatCurrency(Math.abs(value));
}

export function DecomposedTooltipContent(props: DecomposedTooltipContentProps): React.ReactNode {
  const { label, active, scenarios, displayProjections } = props;
  // recharts only mounts the tooltip when `active` is true (or undefined,
  // for the default "always show on hover"). We guard explicitly so the
  // function is safe to call from tests with `active: false`.
  if (active === false) return null;

  const monthISO = typeof label === 'string' ? label : label != null ? String(label) : undefined;
  if (!monthISO) return null;

  const visible = scenarios.filter((sc) => sc.visible && sc.id != null);
  if (visible.length === 0) return null;

  return (
    <div
      data-testid="whatif-projection-tooltip"
      className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md"
      style={{ pointerEvents: 'none' }}
    >
      <div className="mb-1 font-medium text-foreground">{monthISO}</div>
      {visible.map((sc) => {
        const scId = sc.id!;
        const states = displayProjections.get(scId);
        if (!states) return null;
        const idx = findStateIndex(states, monthISO);
        if (idx < 0) return null;
        const cur = states[idx];
        const prev = idx > 0 ? states[idx - 1] : null;
        const netChange = prev ? cur.netWorth - prev.netWorth : 0;
        const rows = decomposeStep(cur).filter((r) => Math.abs(r.value) > 0.005);
        return (
          <div
            key={scId}
            data-testid={`whatif-projection-tooltip-scenario-${scId}`}
            className="mb-1 last:mb-0"
          >
            <div className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-sm"
                style={{ backgroundColor: sc.color }}
              />
              <span className="font-medium">{sc.name}</span>
            </div>
            <div className="ml-3.5 mt-0.5 text-foreground">
              Net worth:{' '}
              <span className="font-mono tabular-nums">{formatCurrency(cur.netWorth)}</span>
            </div>
            {prev && (
              <div className="ml-3.5 mt-0.5 text-foreground">
                Net change MoM:{' '}
                <span className="font-mono tabular-nums">
                  {formatSigned(netChange, netChange >= 0 ? 'in' : 'out')}
                </span>
              </div>
            )}
            {rows.length > 0 && (
              <ul className="ml-5 mt-1 space-y-0.5 text-muted-foreground">
                {rows.map((row) => (
                  <li
                    key={row.label}
                    data-testid={`whatif-projection-tooltip-row-${scId}-${row.label.toLowerCase().replace(/\s+/g, '-')}`}
                    className="flex items-baseline justify-between gap-3"
                  >
                    <span>&middot; {row.label}</span>
                    <span className="font-mono tabular-nums">
                      {formatSigned(row.value, row.direction)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
