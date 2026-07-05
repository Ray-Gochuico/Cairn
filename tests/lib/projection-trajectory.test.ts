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

describe('balanceTrajectory — contributionGrowth (real-flat contributions in the nominal frame)', () => {
  it('grows the year-t contribution by (1+g)^t: year 1 = pv·(1+r) + pmt·(1+g)', () => {
    const pts = balanceTrajectory(1000, 100, 0.07, 2, 0.03);
    expect(pts[0].balance).toBeCloseTo(1000, 10);
    expect(pts[1].balance).toBeCloseTo(1000 * 1.07 + 100 * 1.03, 8);
    expect(pts[2].balance).toBeCloseTo((1000 * 1.07 + 100 * 1.03) * 1.07 + 100 * 1.03 ** 2, 8);
  });

  it('deflated growth-mode trajectory equals the real-rate closed form yearsToFi inverts', () => {
    // b_real(t) = B_t/(1+i)^t must equal pv·(1+rr)^t + pmt·((1+rr)^t − 1)/rr
    // with rr = (1+r)/(1+i) − 1 (exact Fisher) — the algebraic bridge that
    // makes the chart crossing equal ceil(yearsToFi) in Task 5's chart test.
    const [pv, pmt, r, i] = [100_000, 20_000, 0.06, 0.025];
    const rr = (1 + r) / (1 + i) - 1;
    const pts = balanceTrajectory(pv, pmt, r, 30, i);
    for (const t of [1, 7, 19, 30]) {
      const real = pts[t].balance / (1 + i) ** t;
      const closed = pv * (1 + rr) ** t + (pmt * ((1 + rr) ** t - 1)) / rr;
      expect(real).toBeCloseTo(closed, 6);
    }
  });

  it('growth 0 (and omitted) reproduces the existing closed form exactly', () => {
    const a = balanceTrajectory(1000, 100, 0.07, 10);
    const b = balanceTrajectory(1000, 100, 0.07, 10, 0);
    for (let t = 0; t <= 10; t++) expect(b[t].balance).toBe(a[t].balance);
  });
});
