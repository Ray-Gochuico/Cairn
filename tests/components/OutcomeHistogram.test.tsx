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

  it('the $0 bucket Cell uses the destructive token color', () => {
    render(<OutcomeHistogram result={makeResult()} goalAmount={1_000_000} />);
    const cells = screen.getAllByTestId('rc-cell');
    // First cell ($0 bucket) should use --destructive token
    expect(cells[0].getAttribute('data-fill')).toContain('--destructive');
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
});
