import { describe, it, expect } from 'vitest';
import { computeEquityValue } from '@/lib/equity-value';

const grant = {
  grantDate: '2024-01-15',
  strikePrice: 5,
  totalShares: 1000,
  currentFmv: 50,
  vestingSchedule: [
    { date: '2025-01-15', cumulativePct: 0.25 },
    { date: '2026-01-15', cumulativePct: 0.50 },
    { date: '2027-01-15', cumulativePct: 0.75 },
    { date: '2028-01-15', cumulativePct: 1.00 },
  ],
};

describe('computeEquityValue', () => {
  it('returns 0 vested before cliff', () => {
    const result = computeEquityValue(grant, new Date('2024-06-01'));
    expect(result.vestedShares).toBe(0);
    expect(result.vestedValue).toBe(0);
  });

  it('returns 25% vested after first cliff', () => {
    const result = computeEquityValue(grant, new Date('2025-06-01'));
    expect(result.vestedShares).toBe(250);
    expect(result.vestedValue).toBe(250 * 50);
    expect(result.unvestedShares).toBe(750);
  });

  it('returns 100% vested after final entry', () => {
    const result = computeEquityValue(grant, new Date('2029-01-01'));
    expect(result.vestedShares).toBe(1000);
    expect(result.unvestedShares).toBe(0);
  });

  it('upcoming vest dates lists next 3 future entries', () => {
    const result = computeEquityValue(grant, new Date('2025-06-01'));
    expect(result.upcomingVestDates).toEqual(['2026-01-15', '2027-01-15', '2028-01-15']);
  });

  it('monthlyCost amortizes total strike cost over vesting duration', () => {
    // total strike = 5 * 1000 = 5000; vesting duration = 48 months
    const result = computeEquityValue(grant, new Date('2025-06-01'));
    expect(result.monthlyCost).toBeCloseTo(5000 / 48, 2);
  });

  // Bonus tests
  it('strike price = 0 (RSU) yields monthlyCost = 0', () => {
    const rsuGrant = { ...grant, strikePrice: 0 };
    const result = computeEquityValue(rsuGrant, new Date('2025-06-01'));
    expect(result.monthlyCost).toBe(0);
  });

  it('single-entry schedule (immediate full vest at grant date) clamps duration to 1 month', () => {
    const immediateGrant = {
      grantDate: '2024-01-15',
      strikePrice: 10,
      totalShares: 100,
      currentFmv: 25,
      vestingSchedule: [{ date: '2024-01-15', cumulativePct: 1.0 }],
    };
    const result = computeEquityValue(immediateGrant, new Date('2024-06-01'));
    // duration = max(1, 0 months) = 1; monthlyCost = 10 * 100 / 1 = 1000
    expect(result.monthlyCost).toBe(1000);
    expect(result.vestedShares).toBe(100);
    expect(result.unvestedShares).toBe(0);
  });

  it('today exactly on a vest date counts that entry (<= condition)', () => {
    // 2025-01-15 is exactly the first vest date; pct should be 0.25
    const result = computeEquityValue(grant, new Date('2025-01-15T12:00:00Z'));
    expect(result.vestedShares).toBe(250);
  });

  it('upcomingVestDates is empty array when fully vested', () => {
    const result = computeEquityValue(grant, new Date('2029-01-01'));
    expect(result.upcomingVestDates).toEqual([]);
  });

  it('currentFmv = 0 yields vestedValue = 0 regardless of shares', () => {
    const zeroFmvGrant = { ...grant, currentFmv: 0 };
    const result = computeEquityValue(zeroFmvGrant, new Date('2025-06-01'));
    expect(result.vestedValue).toBe(0);
    expect(result.unvestedValue).toBe(0);
    // shares still vest correctly
    expect(result.vestedShares).toBe(250);
    expect(result.unvestedShares).toBe(750);
  });
});
