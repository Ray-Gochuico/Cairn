import { memo, useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { BacktestResult } from '@/lib/backtest';
import { CHART_PALETTE } from '@/components/charts/palette';
import { CHART_TOOLTIP_PROPS } from '@/components/charts/ChartTooltip';
import { formatCompactCurrency } from '@/lib/format';

interface Props { result: BacktestResult; goalAmount: number; }

interface Bucket { label: string; lo: number; hi: number; }

// Tokens shared with BacktestChart so the two charts read as one palette (B1/B3).
// T2 fix: use --chart-danger/--chart-warning (≥3:1 contrast on thin strokes on both
// themes) instead of raw --destructive/--warning which drop to ~2:1 as bar fills.
const BAR_DEPLETED = 'hsl(var(--chart-danger))';
const BAR_BELOW = 'hsl(var(--chart-warning))';
const BAR_MET = CHART_PALETTE[0];

function buildBuckets(result: BacktestResult, goalAmount: number): Bucket[] {
  const max = Math.max(1, ...result.outcomes.map((o) => o.endingBalance));
  if (goalAmount > 0) {
    // Goal-relative buckets (monotonic because goal > 0).
    const e = [0, 1, goalAmount, goalAmount * 2, goalAmount * 4, goalAmount * 8, Infinity];
    const labels = ['$0', '<goal', 'goal–2×', '2–4×', '4–8×', '8×+'];
    return labels.map((label, i) => ({ label, lo: e[i], hi: e[i + 1] }));
  }
  // SF-4: goal === 0 (default) → fixed absolute edges scaled to the data max.
  // A simple step sized to cover `max` in ~6 buckets above $0.
  // T2 fix: build CONTIGUOUS edges: 1, step, 2·step, 3·step, …
  // Buckets: [0,1) → $0 depleted; [1,step); [step,2·step); [2·step,3·step); …
  // Old code: first live bucket was [1, step) then next was [step+1, step+step)
  // leaving a gap at [step, step+1) — any ending exactly equal to `step` (a
  // 250k multiple) was silently dropped. Aligning hi to step-multiples fixes it.
  const step = Math.max(250_000, Math.ceil(max / 6 / 250_000) * 250_000);
  const buckets: Bucket[] = [{ label: '$0', lo: 0, hi: 1 }];
  // First live bucket: [1, step) — values $1 to just below the first step mark.
  // Subsequent: [step, 2·step), [2·step, 3·step), … via lo = k·step for k=1,2,…
  // We iterate by adding `step` to `lo` each time, starting from 1 (special case).
  let lo = 1;
  while (lo < max + step) {
    const hi = lo === 1 ? step : lo + step;
    buckets.push({
      label: `${formatCompactCurrency(lo === 1 ? 0 : lo)}–${formatCompactCurrency(hi)}`,
      lo,
      hi,
    });
    lo = lo === 1 ? step : lo + step;
  }
  return buckets;
}

function OutcomeHistogramInner({ result, goalAmount }: Props) {
  // T2 perf fix: memoize the bucket computation + derived data on [result, goalAmount].
  // Previously recomputed every render (mode toggle, form keystrokes after a run).
  const { buckets, data, nonEmptyBuckets } = useMemo(() => {
    const bkts = buildBuckets(result, goalAmount);
    const counts = new Array(bkts.length).fill(0);
    for (const o of result.outcomes) {
      const v = o.endingBalance;
      if (v <= 0) { counts[0] += 1; continue; }
      for (let b = 1; b < bkts.length; b++) {
        if (v >= bkts[b].lo && v < bkts[b].hi) { counts[b] += 1; break; }
      }
    }
    const d = bkts.map((bkt, i) => ({ label: bkt.label, count: counts[i] }));
    const neb = d.filter((row) => row.count > 0).length;
    return { buckets: bkts, data: d, nonEmptyBuckets: neb };
  }, [result, goalAmount]);

  // Color: $0 chart-danger; below a positive goal chart-warning; otherwise blue.
  // With goal ≤ 0 only the $0 bucket is "failure", everything above is blue.
  const colorFor = (i: number, bkt: Bucket) => {
    if (i === 0) return BAR_DEPLETED;
    if (goalAmount > 0 && bkt.hi <= goalAmount) return BAR_BELOW;
    return BAR_MET;
  };

  // Goal line: only meaningful with a positive goal. Anchor at the first
  // at-or-above-goal bucket label.
  const goalBucketLabel = goalAmount > 0
    ? buckets.find((b) => b.lo >= goalAmount)?.label ?? null
    : null;

  // SF-4 regression guard: number of buckets that actually received outcomes.
  // With the non-monotonic-edges bug at goal=0 every survivor bucket is 0, so
  // this collapses to 1 ($0 bucket only) — the Task-12 test asserts it's > 1.

  return (
    <div data-testid="backtest-histogram" data-bucket-count={nonEmptyBuckets} style={{ height: 200 }}>
      {/* T2 fix: explicit height={200} instead of "100%" avoids Recharts
          "width(-1)/height(-1)" warning on first measure in a fixed-height parent */}
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
          <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} allowDecimals={false} width={32} />
          {/* B2 — hover-to-read parity with every other Cairn chart. */}
          <Tooltip {...CHART_TOOLTIP_PROPS} isAnimationActive={false}
            formatter={(v) => [`${v ?? 0} of ${result.startYears.count} starts`, 'Count']}
            labelFormatter={(label) => `Ending balance ${label}`} />
          {goalBucketLabel && (
            // B3 — tokenized goal line + label (was literal #f59e0b / #b45309).
            <ReferenceLine x={goalBucketLabel} stroke="hsl(var(--warning))" strokeDasharray="5 4"
              label={{ value: 'goal', fill: 'hsl(var(--warning-foreground))', fontSize: 10, position: 'top' }} />
          )}
          <Bar dataKey="count" isAnimationActive={false} radius={[3, 3, 0, 0]}>
            {data.map((_, i) => <Cell key={i} fill={colorFor(i, buckets[i])} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// T2 perf fix: wrap in memo() so parent re-renders (mode toggle, form keystrokes)
// don't re-render the histogram when result+goalAmount haven't changed.
export const OutcomeHistogram = memo(OutcomeHistogramInner);
