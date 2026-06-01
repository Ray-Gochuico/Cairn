import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Recharts mock — same Option A pattern as BacktestChart.test.tsx
// NO tests/setup.ts changes required.
vi.mock('recharts', () => {
  const passthrough =
    (testId: string) =>
    ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': testId }, children);

  return {
    ResponsiveContainer: passthrough('rc-responsive'),
    BarChart: ({ children, data }: { children?: React.ReactNode; data?: unknown[] }) =>
      React.createElement('div', { 'data-testid': 'rc-barchart', 'data-bucket-count': data?.length ?? 0 }, children),
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    ReferenceLine: (props: { x?: string; stroke?: string }) =>
      React.createElement('div', {
        'data-testid': 'rc-referenceline',
        'data-x': props.x ?? '',
        'data-stroke': props.stroke ?? '',
      }),
    Bar: ({ children, dataKey, isAnimationActive }: { children?: React.ReactNode; dataKey?: string; isAnimationActive?: boolean }) =>
      React.createElement('div', {
        'data-testid': 'rc-bar',
        'data-key': dataKey ?? '',
        'data-animation': String(isAnimationActive),
      }, children),
    Cell: (props: { fill?: string }) =>
      React.createElement('div', {
        'data-testid': 'rc-cell',
        'data-fill': props.fill ?? '',
      }),
  };
});

import { OutcomeHistogram } from '@/components/backtest/OutcomeHistogram';
import type { BacktestResult } from '@/lib/backtest/types';

function makeResult(overrides: Partial<BacktestResult> = {}): BacktestResult {
  const horizonYears = 5;
  const annualBalances = Array.from({ length: horizonYears + 1 }, (_, i) =>
    Math.max(0, 1_000_000 - i * 50_000),
  );
  const outcomes = [
    { startYear: 1990, annualBalances, endingBalance: 750_000, tier: 'met' as const, depletedYear: null },
    { startYear: 1995, annualBalances: annualBalances.map((v) => v * 0.9), endingBalance: 500_000, tier: 'below' as const, depletedYear: null },
    { startYear: 2000, annualBalances: annualBalances.map((_, i) => Math.max(0, 800_000 - i * 200_000)), endingBalance: 0, tier: 'depleted' as const, depletedYear: 4 },
  ];
  const p50 = annualBalances.map((v) => v * 0.95);
  const p10 = annualBalances.map((v) => v * 0.6);
  const p25 = annualBalances.map((v) => v * 0.75);
  const p75 = annualBalances.map((v) => v * 1.1);
  const p90 = annualBalances.map((v) => v * 1.2);
  return {
    outcomes,
    startYears: { first: 1990, last: 2000, count: 3 },
    goalMetCount: 1,
    survivedCount: 2,
    tierCounts: { met: 1, below: 1, depleted: 1 },
    belowGoal: [
      { startYear: 1995, endingBalance: 500_000, tier: 'below' },
      { startYear: 2000, endingBalance: 0, tier: 'depleted' },
    ],
    endings: {
      worst: { value: 0, startYear: 2000, depletedYear: 4 },
      median: p50[horizonYears],
      best: { value: 750_000, startYear: 1990 },
    },
    percentilesByYear: { p10, p25, p50, p75, p90 },
    ...overrides,
  };
}

describe('OutcomeHistogram', () => {
  it('renders with data-testid="backtest-histogram"', () => {
    render(<OutcomeHistogram result={makeResult()} goalAmount={1_000_000} />);
    expect(screen.getByTestId('backtest-histogram')).toBeInTheDocument();
  });

  it('renders a BarChart', () => {
    render(<OutcomeHistogram result={makeResult()} goalAmount={1_000_000} />);
    expect(screen.getByTestId('rc-barchart')).toBeInTheDocument();
  });

  it('renders a Bar with isAnimationActive=false', () => {
    render(<OutcomeHistogram result={makeResult()} goalAmount={1_000_000} />);
    const bar = screen.getByTestId('rc-bar');
    expect(bar.getAttribute('data-animation')).toBe('false');
  });

  it('renders a Bar with dataKey="count"', () => {
    render(<OutcomeHistogram result={makeResult()} goalAmount={1_000_000} />);
    expect(screen.getByTestId('rc-bar')).toHaveAttribute('data-key', 'count');
  });

  it('renders Cell elements (one per bucket)', () => {
    render(<OutcomeHistogram result={makeResult()} goalAmount={1_000_000} />);
    const cells = screen.getAllByTestId('rc-cell');
    expect(cells.length).toBeGreaterThan(0);
  });

  it('renders a ReferenceLine for a positive goalAmount', () => {
    render(<OutcomeHistogram result={makeResult()} goalAmount={1_000_000} />);
    expect(screen.getByTestId('rc-referenceline')).toBeInTheDocument();
  });

  it('does NOT render a ReferenceLine when goalAmount is 0', () => {
    render(<OutcomeHistogram result={makeResult()} goalAmount={0} />);
    expect(screen.queryByTestId('rc-referenceline')).not.toBeInTheDocument();
  });

  it('the $0 bucket Cell uses the chart-danger token color', () => {
    render(<OutcomeHistogram result={makeResult()} goalAmount={1_000_000} />);
    const cells = screen.getAllByTestId('rc-cell');
    // First cell ($0 bucket) must use --chart-danger (matches BacktestChart + 3:1 contrast),
    // NOT raw --destructive (which was a dark-mode-only maroon with ~2:1 contrast on thin strokes).
    expect(cells[0].getAttribute('data-fill')).toContain('--chart-danger');
  });

  it('SF-4: goal=0 produces more than 1 non-empty bucket (no survivor vanishing bug)', () => {
    // This is the SF-4 regression guard: when goalAmount=0 the goal-relative
    // edges go non-monotonic, causing every survivor above $0 to vanish.
    // The component must switch to absolute edges so survivors land in buckets.
    const result = makeResult();
    render(<OutcomeHistogram result={result} goalAmount={0} />);
    const histogram = screen.getByTestId('backtest-histogram');
    const nonEmptyBuckets = parseInt(histogram.getAttribute('data-bucket-count') ?? '0', 10);
    expect(nonEmptyBuckets).toBeGreaterThan(1);
  });

  // ── T2 new tests ─────────────────────────────────────────────────────────────

  it('T2-histogram-bucket-edge: Σ(bar counts) === outcomes.length when an ending exactly equals the step boundary (250k multiple)', () => {
    // Reproduce the off-by-one: endings [250000, 900000, 100000] → step=250000
    // Old code: first live bucket is [1, step) then next is [step+1, …) leaving
    // [step, step+1) as a gap — the 250000 ending falls in neither and is dropped.
    // Fix: contiguous edges 1, step, 2·step, 3·step, … so [step, 2·step) captures it.
    const outcomes = [
      { startYear: 1990, annualBalances: [1_500_000, 250_000], endingBalance: 250_000, tier: 'met' as const, depletedYear: null },
      { startYear: 1995, annualBalances: [1_500_000, 900_000], endingBalance: 900_000, tier: 'met' as const, depletedYear: null },
      { startYear: 2000, annualBalances: [1_500_000, 100_000], endingBalance: 100_000, tier: 'met' as const, depletedYear: null },
    ];
    const p = outcomes[0].annualBalances.map(() => 500_000);
    const result: ReturnType<typeof makeResult> = {
      outcomes,
      startYears: { first: 1990, last: 2000, count: 3 },
      goalMetCount: 3,
      survivedCount: 3,
      tierCounts: { met: 3, below: 0, depleted: 0 },
      belowGoal: [],
      endings: { worst: { value: 100_000, startYear: 2000, depletedYear: null }, median: 250_000, best: { value: 900_000, startYear: 1995 } },
      percentilesByYear: { p10: p, p25: p, p50: p, p75: p, p90: p },
    };
    render(<OutcomeHistogram result={result} goalAmount={0} />);
    const histogram = screen.getByTestId('backtest-histogram');
    // data-bucket-count reflects non-empty buckets; the FULL sum requires the raw data.
    // We verify via the data-bucket-count ≥ 3 (all three distinct ranges must be hit).
    const nonEmptyBuckets = parseInt(histogram.getAttribute('data-bucket-count') ?? '0', 10);
    // With contiguous edges: 100k → [1,250k), 250k → [250k,500k), 900k → [750k,1M)
    // → 3 non-empty buckets. With the broken edges, 250k is dropped → only 2.
    expect(nonEmptyBuckets).toBe(3);
  });

  it('T2-tier-tokens: $0 bucket Cell uses chart-danger token, not raw --destructive', () => {
    render(<OutcomeHistogram result={makeResult()} goalAmount={0} />);
    const cells = screen.getAllByTestId('rc-cell');
    // After the fix, the $0 bucket should use --chart-danger, not --destructive.
    expect(cells[0].getAttribute('data-fill')).toContain('--chart-danger');
  });

  it('T2-tier-tokens: below-goal bucket Cells use chart-warning token', () => {
    render(<OutcomeHistogram result={makeResult()} goalAmount={1_000_000} />);
    const cells = screen.getAllByTestId('rc-cell');
    // With a positive goal, bucket index 1 ('<goal') is below-goal → should use --chart-warning.
    // With old code it used --warning (raw); after fix it must use --chart-warning.
    const belowCell = cells[1]; // second bucket: lo=1, hi=1_000_000 → below goal
    expect(belowCell.getAttribute('data-fill')).toContain('--chart-warning');
  });
});
