import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BelowGoalList } from '@/components/backtest/BelowGoalList';
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

describe('BelowGoalList', () => {
  it('renders with data-testid="backtest-below-goal"', () => {
    render(<BelowGoalList result={makeResult()} goalAmount={1_000_000} />);
    expect(screen.getByTestId('backtest-below-goal')).toBeInTheDocument();
  });

  it('shows each below-goal start year', () => {
    render(<BelowGoalList result={makeResult()} goalAmount={1_000_000} />);
    expect(screen.getByText(/1995/)).toBeInTheDocument();
    expect(screen.getByText(/2000/)).toBeInTheDocument();
  });

  it('shows "$0" for depleted entries', () => {
    render(<BelowGoalList result={makeResult()} goalAmount={1_000_000} />);
    expect(screen.getByText('$0')).toBeInTheDocument();
  });

  it('shows the count and header', () => {
    render(<BelowGoalList result={makeResult()} goalAmount={1_000_000} />);
    // "2 of 3"
    expect(screen.getByText(/2 of 3/)).toBeInTheDocument();
  });

  it('uses glyph ✕ for depleted entries (non-color cue)', () => {
    render(<BelowGoalList result={makeResult()} goalAmount={1_000_000} />);
    // The ✕ glyph appears inside the depleted badge
    const glyphs = screen.getAllByText('✕');
    expect(glyphs.length).toBeGreaterThan(0);
  });

  it('uses glyph ↓ for below-goal (not depleted) entries', () => {
    render(<BelowGoalList result={makeResult()} goalAmount={1_000_000} />);
    const glyphs = screen.getAllByText('↓');
    expect(glyphs.length).toBeGreaterThan(0);
  });

  it('renders null / nothing when belowGoal is empty (empty state)', () => {
    const result = makeResult({ belowGoal: [] });
    const { container } = render(<BelowGoalList result={result} goalAmount={1_000_000} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the "depleted" sr-only label for accessibility', () => {
    render(<BelowGoalList result={makeResult()} goalAmount={1_000_000} />);
    expect(screen.getByText('Depleted:')).toBeInTheDocument();
  });

  it('shows the "below goal" sr-only label for accessibility', () => {
    render(<BelowGoalList result={makeResult()} goalAmount={1_000_000} />);
    expect(screen.getByText('Below goal:')).toBeInTheDocument();
  });
});
