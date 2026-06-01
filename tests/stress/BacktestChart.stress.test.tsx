/**
 * Backtest chart mount bench — 120 Recharts <Line> series × 31 annual points.
 *
 * Why this file exists (and is committed, not throwaway):
 *   - Same structural reason as engine.stress.test.ts: three review waves in a
 *     row produced an untracked `*-bench` file that auto-ran and silently
 *     disappeared (docs/reviews/2026-05-27-testing-wave3.md § N4). The fix is
 *     to commit one canonical bench, gate it behind STRESS=1, and keep it out
 *     of the default `npm test`.
 *   - This bench is the durable regression bar for the Task-1 perf-spike
 *     DECISION (docs/research/2026-05-28-backtest-perf-spike.md). The backtest
 *     "spaghetti" chart renders ~120 faint per-window <Line>s plus a median.
 *     jsdom CANNOT measure real paint/hover (that's the manual DevTools read in
 *     the spike), but it CAN guard the mount-time cost: 120 <Line> series must
 *     construct + mount without blowing a generous wall-clock budget. If this
 *     starts failing, the chart has regressed toward the Recharts ~150-line
 *     cliff and the Option-A (pure Recharts) decision must be re-checked
 *     against Option B (a <canvas> overlay for the lines).
 *   - `npm run test:stress` runs this; CI can opt in via the same script.
 *
 * Notes on fidelity:
 *   - Fixed-size <LineChart width/height> (NOT <ResponsiveContainer>) on
 *     purpose: ResponsiveContainer measures its 0×0 parent in jsdom and emits
 *     no concrete SVG (see tests/components/ProjectionChart.test.tsx, which
 *     mocks recharts for exactly that reason). A fixed size makes recharts emit
 *     real <path class="recharts-line-curve"> elements, so the assertion below
 *     verifies the lines actually mounted rather than no-op'ing.
 *   - `isAnimationActive={false}` on every <Line> per the repo convention
 *     (docs/superpowers/conventions.md — recharts 3.x animation-loop gotcha).
 *
 * The budget is deliberately generous: jsdom path construction is ~3–4× slower
 * than a real WebKit/Blink paint, and this runs on CI hardware of unknown
 * speed. The point is to catch an order-of-magnitude regression, not to assert
 * a tight number.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { LineChart, Line, XAxis, YAxis } from 'recharts';

const stressEnabled = process.env.STRESS === '1';
const dscribe = stressEnabled ? describe : describe.skip;

const N_LINES = 120;
const POINTS = 31;
const MOUNT_BUDGET_MS = 2_000; // jsdom is ~3-4x slower than WebKit; generous headroom

// 120 series of 31 monotonic-ish annual points, merged into one rows array
// keyed by year (mirrors the perf-spike synthetic data so the bench and the
// recorded decision measure the same shape).
const rows = Array.from({ length: POINTS }, (_, y) => {
  const row: Record<string, number> = { year: 1994 + y };
  for (let s = 0; s < N_LINES; s++) {
    row[`s${s}`] = 1_500_000 * Math.pow(1 + (s % 7) * 0.004, y);
  }
  return row;
});

dscribe('BacktestChart 120-line mount bench', () => {
  it(`mounts ${N_LINES} lines × ${POINTS} pts under ${MOUNT_BUDGET_MS}ms`, () => {
    const t0 = performance.now();
    const { container } = render(
      <LineChart width={800} height={400} data={rows}>
        <XAxis dataKey="year" />
        <YAxis />
        {Array.from({ length: N_LINES }, (_, s) => (
          <Line key={s} dataKey={`s${s}`} dot={false} isAnimationActive={false} strokeWidth={1} />
        ))}
      </LineChart>,
    );
    const elapsed = performance.now() - t0;

    // Recharts emits one <path class="recharts-line-curve"> per <Line>; assert
    // they actually mounted (guards against the chart silently rendering
    // nothing), then assert the mount stayed under budget.
    expect(container.querySelectorAll('path.recharts-line-curve').length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(MOUNT_BUDGET_MS);
  });
});
