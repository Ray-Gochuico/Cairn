import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OutcomeSummary } from '@/components/backtest/OutcomeSummary';
import type { BacktestResult } from '@/lib/backtest/types';

function makeResult(overrides: Partial<BacktestResult> = {}): BacktestResult {
  const horizonYears = 5;
  const annualBalances = Array.from({ length: horizonYears + 1 }, (_, i) =>
    Math.max(0, 1_000_000 - i * 50_000),
  );
  const outcomes = [
    { startYear: 1990, annualBalances, endingBalance: annualBalances[horizonYears], tier: 'met' as const, depletedYear: null },
    { startYear: 1995, annualBalances: annualBalances.map((v) => v * 0.9), endingBalance: annualBalances[horizonYears] * 0.9, tier: 'below' as const, depletedYear: null },
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
      { startYear: 1995, endingBalance: annualBalances[horizonYears] * 0.9, tier: 'below' },
      { startYear: 2000, endingBalance: 0, tier: 'depleted' },
    ],
    endings: {
      worst: { value: 0, startYear: 2000, depletedYear: 4 },
      median: p50[horizonYears],
      best: { value: annualBalances[horizonYears], startYear: 1990 },
    },
    percentilesByYear: { p10, p25, p50, p75, p90 },
    ...overrides,
  };
}

describe('OutcomeSummary', () => {
  it('renders with data-testid="backtest-summary"', () => {
    render(<OutcomeSummary result={makeResult()} goalAmount={1_000_000} />);
    expect(screen.getByTestId('backtest-summary')).toBeInTheDocument();
  });

  it('displays the goal-met percentage as a headline', () => {
    // 1 of 3 = 33%
    render(<OutcomeSummary result={makeResult()} goalAmount={1_000_000} />);
    expect(screen.getByText('33%')).toBeInTheDocument();
  });

  it('shows goal-met count and total', () => {
    render(<OutcomeSummary result={makeResult()} goalAmount={1_000_000} />);
    // "1 of 3" should appear in the description
    expect(screen.getByText(/1 of 3/)).toBeInTheDocument();
  });

  it('shows survived count (distinct from goal-met)', () => {
    render(<OutcomeSummary result={makeResult()} goalAmount={1_000_000} />);
    // survivedCount=2, total=3 → "2 of 3"
    expect(screen.getByText(/2 of 3/)).toBeInTheDocument();
  });

  it('announces the results-ready run-meta line', () => {
    render(<OutcomeSummary result={makeResult()} goalAmount={1_000_000} />);
    expect(screen.getByRole('status')).toHaveTextContent(/historical periods/);
  });

  it('shows the run-meta caption', () => {
    render(<OutcomeSummary result={makeResult()} goalAmount={1_000_000} />);
    const meta = screen.getByTestId('backtest-run-meta');
    expect(meta).toBeInTheDocument();
    expect(meta).toHaveTextContent('3 historical periods');
    expect(meta).toHaveTextContent('real dollars');
    // BT-7: the data span must end at the last Shiller data year (2022), NOT
    // the retrieval date (SHILLER_DATA_AS_OF = 2026-06-01).
    expect(meta.textContent).toMatch(/1871.?2022/);
    expect(meta.textContent).not.toContain('2026');
  });

  it('shows worst ending start year', () => {
    render(<OutcomeSummary result={makeResult()} goalAmount={1_000_000} />);
    // worst startYear is 2000
    expect(screen.getByText(/started 2000/)).toBeInTheDocument();
  });

  it('shows worst ending depleted year when depleted', () => {
    render(<OutcomeSummary result={makeResult()} goalAmount={1_000_000} />);
    // depletedYear: 4
    expect(screen.getByText(/depleted yr 4/)).toBeInTheDocument();
  });

  it('shows best ending start year', () => {
    render(<OutcomeSummary result={makeResult()} goalAmount={1_000_000} />);
    // best startYear is 1990
    expect(screen.getByText(/started 1990/)).toBeInTheDocument();
  });

  it('shows worst, median, best tile labels', () => {
    render(<OutcomeSummary result={makeResult()} goalAmount={1_000_000} />);
    expect(screen.getByText('Worst ending')).toBeInTheDocument();
    expect(screen.getByText('Median ending')).toBeInTheDocument();
    expect(screen.getByText('Best ending')).toBeInTheDocument();
  });

  it('renders 100% when all periods meet the goal', () => {
    const result = makeResult({
      goalMetCount: 5,
      startYears: { first: 2000, last: 2004, count: 5 },
    });
    render(<OutcomeSummary result={result} goalAmount={500_000} />);
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('renders 0% when no periods meet the goal', () => {
    const result = makeResult({
      goalMetCount: 0,
      startYears: { first: 2000, last: 2002, count: 3 },
    });
    render(<OutcomeSummary result={result} goalAmount={2_000_000} />);
    expect(screen.getByText('0%')).toBeInTheDocument();
  });
});
