import { describe, it, expect } from 'vitest';
import { computeTakeHome } from '@/lib/paycheck-takehome';

describe('computeTakeHome', () => {
  it('subtracts pretax, tax, post-tax, and extra withholding from gross', () => {
    expect(
      computeTakeHome({
        gross: 100000,
        pretaxTotal: 10000,
        taxTotal: 25000,
        postTaxTotal: 5000,
        extraWithholdingTotal: 1200,
      }),
    ).toBe(100000 - 10000 - 25000 - 5000 - 1200);
  });

  it('matches the legacy gross - pretax - tax when post-tax and extra are 0', () => {
    expect(
      computeTakeHome({
        gross: 95000,
        pretaxTotal: 8350,
        taxTotal: 21976,
        postTaxTotal: 0,
        extraWithholdingTotal: 0,
      }),
    ).toBe(95000 - 8350 - 21976);
  });

  it('clamps at 0 — never returns a negative take-home', () => {
    expect(
      computeTakeHome({
        gross: 20000,
        pretaxTotal: 5000,
        taxTotal: 10000,
        postTaxTotal: 4000,
        extraWithholdingTotal: 3000,
      }),
    ).toBe(0);
  });

  it('a $1 increase in post-tax lowers take-home by exactly $1', () => {
    const base = computeTakeHome({
      gross: 80000, pretaxTotal: 0, taxTotal: 15000, postTaxTotal: 1000, extraWithholdingTotal: 0,
    });
    const more = computeTakeHome({
      gross: 80000, pretaxTotal: 0, taxTotal: 15000, postTaxTotal: 1001, extraWithholdingTotal: 0,
    });
    expect(base - more).toBeCloseTo(1, 6);
  });

  it('a $1 increase in extra withholding lowers take-home by exactly $1', () => {
    const base = computeTakeHome({
      gross: 80000, pretaxTotal: 0, taxTotal: 15000, postTaxTotal: 0, extraWithholdingTotal: 500,
    });
    const more = computeTakeHome({
      gross: 80000, pretaxTotal: 0, taxTotal: 15000, postTaxTotal: 0, extraWithholdingTotal: 501,
    });
    expect(base - more).toBeCloseTo(1, 6);
  });
});
