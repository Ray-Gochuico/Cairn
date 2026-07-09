import { describe, it, expect } from 'vitest';
import { computeGoalProgress } from '@/lib/goal-progress';

describe('computeGoalProgress', () => {
  const today = new Date('2026-01-01');

  it('marks goal on-track when projected at target >= target_amount', () => {
    const result = computeGoalProgress({
      targetAmount: 50_000,
      targetDate: '2031-01-01', // 60 months out
      currentSaved: 30_000,
      recentMonthlyContribution: 500, // $6k/yr
      annualGrowthRate: 0.06,
      today,
    });
    // PV=30k, PMT=500/mo, r=0.5%/mo, n=60 → FV ≈ 30k*(1.005)^60 + 500*((1.005)^60-1)/0.005
    //                                       ≈ 30000 * 1.349 + 500 * 69.77 ≈ 40470 + 34885 = 75355
    // 75355 > 50000 → on-track
    expect(result.onTrack).toBe(true);
    expect(result.projectedAtTarget).toBeGreaterThan(50_000);
    expect(result.percentComplete).toBeCloseTo(0.6, 1);
  });

  it('marks goal off-track when projected at target < target_amount', () => {
    const result = computeGoalProgress({
      targetAmount: 200_000,
      targetDate: '2027-01-01', // 12 months out
      currentSaved: 30_000,
      recentMonthlyContribution: 500,
      annualGrowthRate: 0.06,
      today,
    });
    expect(result.onTrack).toBe(false);
    expect(result.linearMonthlyNeeded).toBeGreaterThan(500);
  });

  it('returns 0 monthsUntilTarget when target_date is in the past', () => {
    const result = computeGoalProgress({
      targetAmount: 10_000,
      targetDate: '2024-01-01', // past
      currentSaved: 5_000,
      recentMonthlyContribution: 0,
      annualGrowthRate: 0.06,
      today,
    });
    expect(result.monthsUntilTarget).toBe(0);
  });

  // Bonus tests
  it('handles already-at-target: percentComplete=1, onTrack=true, linearMonthlyNeeded=0', () => {
    const result = computeGoalProgress({
      targetAmount: 50_000,
      targetDate: '2031-01-01', // 60 months out
      currentSaved: 50_000,
      recentMonthlyContribution: 0,
      annualGrowthRate: 0.06,
      today,
    });
    expect(result.percentComplete).toBe(1);
    expect(result.onTrack).toBe(true);
    expect(result.linearMonthlyNeeded).toBe(0);
  });

  it('handles already-past-target: onTrack=true, percentComplete>1', () => {
    const result = computeGoalProgress({
      targetAmount: 50_000,
      targetDate: '2031-01-01',
      currentSaved: 75_000,
      recentMonthlyContribution: 0,
      annualGrowthRate: 0.06,
      today,
    });
    expect(result.onTrack).toBe(true);
    expect(result.percentComplete).toBeGreaterThan(1);
    expect(result.linearMonthlyNeeded).toBe(0);
  });

  it('treats zero growth + linear path as exactly on-track when contributions sum to target', () => {
    // 60 months, need to reach 50k from 20k with 0% growth → need 500/mo exactly
    const result = computeGoalProgress({
      targetAmount: 50_000,
      targetDate: '2031-01-01', // 60 months out
      currentSaved: 20_000,
      recentMonthlyContribution: 500,
      annualGrowthRate: 0,
      today,
    });
    expect(result.projectedAtTarget).toBeCloseTo(50_000, 6);
    expect(result.onTrack).toBe(true);
    expect(result.linearMonthlyNeeded).toBeCloseTo(500, 6);
  });

  it('treats negative monthly contribution (withdrawal) as off-track when it drains projection', () => {
    const result = computeGoalProgress({
      targetAmount: 100_000,
      targetDate: '2031-01-01', // 60 months out
      currentSaved: 50_000,
      recentMonthlyContribution: -1_000, // withdrawing
      annualGrowthRate: 0.06,
      today,
    });
    expect(result.onTrack).toBe(false);
    expect(result.projectedAtTarget).toBeLessThan(100_000);
  });

  it('returns percentComplete=0 defensively when targetAmount is 0', () => {
    const result = computeGoalProgress({
      targetAmount: 0,
      targetDate: '2031-01-01',
      currentSaved: 5_000,
      recentMonthlyContribution: 100,
      annualGrowthRate: 0.06,
      today,
    });
    expect(result.percentComplete).toBe(0);
  });

  it('returns linearMonthlyNeeded=Infinity when target date equals today (no months left)', () => {
    const result = computeGoalProgress({
      targetAmount: 100_000,
      targetDate: '2026-01-01', // same as today
      currentSaved: 50_000,
      recentMonthlyContribution: 500,
      annualGrowthRate: 0.06,
      today,
    });
    expect(result.monthsUntilTarget).toBe(0);
    expect(result.linearMonthlyNeeded).toBe(Infinity);
  });

  it('echoes currentSaved in result', () => {
    const result = computeGoalProgress({
      targetAmount: 50_000,
      targetDate: '2031-01-01',
      currentSaved: 12_345,
      recentMonthlyContribution: 100,
      annualGrowthRate: 0.06,
      today,
    });
    expect(result.currentSaved).toBe(12_345);
  });
});

describe('monthlyNeededWithGrowth (wave-9 M23)', () => {
  const today = new Date('2026-01-01');

  it("solves the annuity PMT at the badge's own growth basis", () => {
    // target 100k, saved 50k, 24mo, 6%/yr → r=0.005:
    // FV(current) = 50,000×1.005^24 = 56,357.99; gap = 43,642.01;
    // PMT = gap × r / (1.005^24 − 1) = 1,716.03.
    const p = computeGoalProgress({
      targetAmount: 100_000,
      targetDate: '2028-01-01', // 24 months out
      currentSaved: 50_000,
      recentMonthlyContribution: 0,
      annualGrowthRate: 0.06,
      today,
    });
    expect(p.monthlyNeededWithGrowth).toBeCloseTo(1_716.03, 1);
  });

  it('r = 0 degenerates to the linear figure', () => {
    const p = computeGoalProgress({
      targetAmount: 12_000,
      targetDate: '2027-01-01', // 12 months out
      currentSaved: 0,
      recentMonthlyContribution: 0,
      annualGrowthRate: 0,
      today,
    });
    expect(p.monthlyNeededWithGrowth).toBe(1_000);
    expect(p.monthlyNeededWithGrowth).toBe(p.linearMonthlyNeeded);
  });

  it('growth alone covering the target needs $0/mo', () => {
    const p = computeGoalProgress({
      targetAmount: 60_000,
      targetDate: '2031-01-01', // 60 months out; 50k×1.005^60 ≈ 67,443 > 60k
      currentSaved: 50_000,
      recentMonthlyContribution: 0,
      annualGrowthRate: 0.06,
      today,
    });
    expect(p.monthlyNeededWithGrowth).toBe(0);
  });
});
