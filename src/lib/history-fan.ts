import { loadShillerAnnual } from '@/data/shiller-schema';
import type { ShillerAnnualRow } from '@/data/shiller';
import { blendedRealReturnForRow } from '@/lib/backtest/data';
import { percentile } from '@/lib/backtest/aggregate';

/** The Backtest page's own seed default, named in the caption — D-UB7/⚑F4. */
export const HISTORY_STOCK_PCT = 0.75;
/** UI rendering rule ONLY (⚑F5): below this the card renders the too-few line,
 *  never the fan. The engine itself is policy-free and always reports the
 *  honest m. */
export const HISTORY_FAN_MIN_SEQUENCES = 30;

export interface HistoryFanInput {
  pv: number;
  /** Real-flat, end-of-year (ordinary-annuity timing — the balanceTrajectory convention). */
  annualContribution: number;
  /** Integer; < 1 (or non-integer) yields the empty result. */
  horizonYears: number;
  /** Real dollars; omit or ≤ 0 ⇒ holds: null. */
  target?: number;
  /** Default HISTORY_STOCK_PCT. */
  stockPct?: number;
  /** TEST SEAM ONLY — contiguous ascending years; defaults to loadShillerAnnual().
   *  Production call sites never pass it. */
  rows?: ShillerAnnualRow[];
}

export interface HistoryFanResult {
  horizonYears: number;
  /** The honest M = census size; 0 when no full window exists. */
  m: number;
  startYears: { first: number; last: number } | null; // null ⇔ m === 0
  /** Per-year order statistics, each length H+1 (year 0 = round(pv)); all [] when m === 0.
   *  Pointwise: no single historical stretch follows any of these curves. */
  byYear: { p25: number[]; p50: number[]; p75: number[] };
  holds: { count: number; target: number } | null; // null when no target OR m === 0
}

/**
 * The history-fan census (W2 D-UB1): replay one contribution plan against EVERY
 * overlapping full-length window of the bundled dataset — all real dollars, no
 * inflation parameter by construction (D-UB6), zero randomness (determinism is
 * structural: fixed dataset, total enumeration, total comparator, fixed op
 * order). Pure and date-pure: no Date, no clock, no I/O, no randomness.
 *
 * The band is a per-year ORDER STATISTIC, not a traced path — no single
 * historical stretch follows the p25 curve — which is why every rendered
 * framing is pointwise. `holds` is the one per-stretch fact here, and it is a
 * COUNT of past stretches, never a rate and never a probability.
 */
export function historyFan(input: HistoryFanInput): HistoryFanResult {
  const rows = input.rows ?? loadShillerAnnual();
  const H = input.horizonYears;
  const stockPct = input.stockPct ?? HISTORY_STOCK_PCT;
  const target = input.target != null && input.target > 0 ? input.target : null;

  const empty: HistoryFanResult = {
    horizonYears: H,
    m: 0,
    startYears: null,
    byYear: { p25: [], p50: [], p75: [] },
    holds: null,
  };
  if (!Number.isInteger(H) || H < 1 || rows.length === 0) return empty;

  const lastYear = rows[rows.length - 1].year;
  const starts = rows.map((r) => r.year).filter((y) => y + H - 1 <= lastYear);
  if (starts.length === 0) return empty;

  const rowByYear = new Map(rows.map((r) => [r.year, r]));
  const paths = starts.map((s) => {
    const b = new Array<number>(H + 1);
    b[0] = input.pv;
    for (let k = 1; k <= H; k++) {
      const row = rowByYear.get(s + k - 1);
      // Unreachable on the Zod-validated contiguous dataset; loud on a broken seam.
      if (!row) throw new Error(`historyFan: missing dataset row for year ${s + k - 1}`);
      b[k] = b[k - 1] * (1 + blendedRealReturnForRow(row, stockPct)) + input.annualContribution;
    }
    return b;
  });

  const p25: number[] = [];
  const p50: number[] = [];
  const p75: number[] = [];
  for (let k = 0; k <= H; k++) {
    const col = paths.map((b) => b[k]).sort((a, b) => a - b);
    p25.push(Math.round(percentile(col, 25)));
    p50.push(Math.round(percentile(col, 50)));
    p75.push(Math.round(percentile(col, 75)));
  }

  const holds =
    target == null
      ? null
      : { count: paths.filter((b) => b.some((v) => v >= target)).length, target };

  return {
    horizonYears: H,
    m: starts.length,
    startYears: { first: starts[0], last: starts[starts.length - 1] },
    byYear: { p25, p50, p75 },
    holds,
  };
}
