import { describe, it, expect } from 'vitest';
import { classifyTier, aggregate } from '@/lib/backtest/aggregate';
import type { StartYearOutcome } from '@/lib/backtest/types';

describe('classifyTier', () => {
  it('depleted when ending <= 0', () => {
    expect(classifyTier(0, 500_000)).toBe('depleted');
    expect(classifyTier(-10, 500_000)).toBe('depleted');
  });
  it('met when ending >= goal', () => {
    expect(classifyTier(500_000, 500_000)).toBe('met');
    expect(classifyTier(600_000, 500_000)).toBe('met');
  });
  it('below when survived but under goal', () => {
    expect(classifyTier(300_000, 500_000)).toBe('below');
  });
  it('goal 0 makes survival == met', () => {
    expect(classifyTier(1, 0)).toBe('met');
    expect(classifyTier(0, 0)).toBe('depleted');
  });
});

function mkOutcome(startYear: number, ending: number, goal: number): StartYearOutcome {
  return {
    startYear,
    annualBalances: [1_500_000, ending],
    endingBalance: ending,
    tier: classifyTier(ending, goal),
    depletedYear: ending <= 0 ? 1 : null,
  };
}

describe('aggregate', () => {
  const goal = 500_000;
  // 5 outcomes: two met (>=500k), two below (>0,<500k), one depleted (0).
  const outcomes = [
    mkOutcome(1871, 2_400_000, goal),
    mkOutcome(1872, 900_000, goal),
    mkOutcome(1929, 300_000, goal),
    mkOutcome(1966, 0, goal),
    mkOutcome(2000, 120_000, goal),
  ];

  it('counts goal-met and survived separately', () => {
    const r = aggregate(outcomes, goal);
    expect(r.goalMetCount).toBe(2);       // met only
    expect(r.survivedCount).toBe(4);      // met + below
    expect(r.tierCounts).toEqual({ met: 2, below: 2, depleted: 1 });
  });

  it('enumerates below-goal start years (below + depleted), sorted by year', () => {
    const r = aggregate(outcomes, goal);
    expect(r.belowGoal.map((b) => b.startYear)).toEqual([1929, 1966, 2000]);
    expect(r.belowGoal.find((b) => b.startYear === 1966)?.tier).toBe('depleted');
    expect(r.belowGoal.find((b) => b.startYear === 2000)?.tier).toBe('below');
  });

  it('reports worst / median / best endings with their start years', () => {
    const r = aggregate(outcomes, goal);
    expect(r.endings.worst.value).toBe(0);
    expect(r.endings.worst.startYear).toBe(1966);
    expect(r.endings.best.value).toBe(2_400_000);
    expect(r.endings.best.startYear).toBe(1871);
    expect(r.endings.median).toBe(300_000); // middle of [0,120k,300k,900k,2.4M]
  });

  it('builds per-year percentile series spanning the horizon', () => {
    const r = aggregate(outcomes, goal);
    // annualBalances length is 2 here, so each percentile series has length 2.
    expect(r.percentilesByYear.p50).toHaveLength(2);
    expect(r.percentilesByYear.p10[0]).toBe(1_500_000); // all start equal
  });

  // T2: percentile interpolation — non-aligned column exercises the linear-interp path.
  // sorted endings: [0, 100_000, 300_000, 900_000]  (4 values)
  // rank for p10 = 0.10 * (4-1) = 0.30 → lo=0 (0), hi=1 (100000) → 0 + 100000*0.30 = 30000
  // rank for p75 = 0.75 * (4-1) = 2.25 → lo=2 (300000), hi=3 (900000) → 300000 + 600000*0.25 = 450000
  it('T2-percentile-interp: linear-interpolated p10/p75 match computed values for non-aligned column', () => {
    const nonAlignedGoal = 500_000;
    const nonAlignedOutcomes = [
      mkOutcome(1871, 0,       nonAlignedGoal),
      mkOutcome(1872, 100_000, nonAlignedGoal),
      mkOutcome(1929, 300_000, nonAlignedGoal),
      mkOutcome(1966, 900_000, nonAlignedGoal),
    ];
    const r = aggregate(nonAlignedOutcomes, nonAlignedGoal);
    // Year-1 column sorted: [0, 100000, 300000, 900000]
    // p10: rank=0.30 → interp between 0 and 100000 → 30000
    expect(r.percentilesByYear.p10[1]).toBe(30_000);
    // p75: rank=2.25 → interp between 300000 and 900000 → 450000
    expect(r.percentilesByYear.p75[1]).toBe(450_000);
  });
});
