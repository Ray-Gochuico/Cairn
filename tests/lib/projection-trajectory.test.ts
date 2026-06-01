import { describe, it, expect } from 'vitest';
import { balanceTrajectory } from '@/lib/projection-trajectory';

describe('balanceTrajectory', () => {
  it('starts at pv (year 0) and grows monotonically', () => {
    const pts = balanceTrajectory(1000, 0, 0.07, 10);
    expect(pts).toHaveLength(11);            // years 0..10 inclusive
    expect(pts[0]).toEqual({ year: 0, balance: 1000 });
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i].balance).toBeGreaterThanOrEqual(pts[i - 1].balance);
    }
    // 1000 * 1.07^10 = 1967.151...
    expect(pts[10].balance).toBeCloseTo(1967.15, 1);
  });

  it('rate=0 is linear pv + pmt*year', () => {
    const pts = balanceTrajectory(1000, 100, 0, 3);
    expect(pts.map((p) => p.balance)).toEqual([1000, 1100, 1200, 1300]);
  });

  it('annuity (pmt only) accrues with the closed-form FV', () => {
    // pv=0, pmt=100/yr, r=10%, 1 year: 0*1.1 + 100*((1.1)-1)/0.1 = 100
    const pts = balanceTrajectory(0, 100, 0.1, 1);
    expect(pts[1].balance).toBeCloseTo(100, 6);
  });

  it('coast case (pmt=0) is pure compounding', () => {
    const pts = balanceTrajectory(500000, 0, 0.06, 2);
    expect(pts[2].balance).toBeCloseTo(500000 * 1.06 ** 2, 4);
  });
});
