import { describe, it, expect } from 'vitest';
import { projectScenario } from '@/lib/scenarios/engine';
import { emptyLeverPayload } from '@/lib/scenarios/lever-types';
import { activeContributionAmount } from '@/lib/scenarios/apply-real';
import type { RealState } from '@/lib/scenarios/state-snapshot';
import type { Holding, Loan, Household, Person } from '@/types/schema';
import type { Bracket } from '@/lib/tax';
import { totalInvestments } from '@/lib/scenarios/aggregate-investments';

const holdings = [
  { id: 1, accountId: 1, ticker: 'VTI', shareCount: 1000, costBasis: 200, targetAllocationPct: null },
] as unknown as Holding[];

const household = {
  id: 1, filingStatus: 'SINGLE', state: 'TX', city: null,
  monthlyExpenseBaseline: 4500, withdrawalRate: 0.04,
  inflationAssumption: 0.025, growthScenarios: [],
} as unknown as Household;

const persons: Person[] = [
  { id: 1, householdId: 1, name: 'P1', annualSalaryPretax: 135000 } as unknown as Person,
];

const federal2026Single: Bracket[] = [
  { min: 0, max: 11600, rate: 0.10 },
  { min: 11600, max: 47150, rate: 0.12 },
  { min: 47150, max: 100525, rate: 0.22 },
  { min: 100525, max: 191950, rate: 0.24 },
  { min: 191950, max: 243725, rate: 0.32 },
  { min: 243725, max: 609350, rate: 0.35 },
  { min: 609350, max: null, rate: 0.37 },
];

// Use TX (no state tax) + zero loans so the v1 surplus-vs-shortfall logic is
// easy to reason about and assert exactly.
const realState: RealState = {
  accounts: [],
  holdings,
  loans: [],
  loanPayments: [],
  household,
  persons,
  baselineMonthlyExpenses: 4500,
  initialCash: 0,
  initialInvestmentsByAccount: { 1: 200000 }, // 1000 shares VTI @ $200 costBasis
  defaults: { inflation: 0, returnRate: 0 }, // 0% return → no growth drift, easier math
  startISO: '2026-05',
  taxBrackets: {
    federal: federal2026Single,
    state: [],
    city: null,
    standardDeduction: 14600,
  },
};

describe('activeContributionAmount', () => {
  it('returns null when no segments are configured', () => {
    expect(activeContributionAmount([], 5)).toBeNull();
  });
  it('returns the amount for a month inside a closed segment', () => {
    expect(activeContributionAmount([{ startMonth: 0, endMonth: 59, monthlyAmount: 1000 }], 30))
      .toBe(1000);
  });
  it('treats endMonth as inclusive', () => {
    const segs = [{ startMonth: 0, endMonth: 11, monthlyAmount: 1000 }];
    expect(activeContributionAmount(segs, 11)).toBe(1000);
    expect(activeContributionAmount(segs, 12)).toBeNull();
  });
  it('treats startMonth as inclusive', () => {
    const segs = [{ startMonth: 12, endMonth: 23, monthlyAmount: 500 }];
    expect(activeContributionAmount(segs, 11)).toBeNull();
    expect(activeContributionAmount(segs, 12)).toBe(500);
  });
  it('handles open-ended segments via endMonth = null', () => {
    const segs = [{ startMonth: 120, endMonth: null, monthlyAmount: 2500 }];
    expect(activeContributionAmount(segs, 119)).toBeNull();
    expect(activeContributionAmount(segs, 120)).toBe(2500);
    expect(activeContributionAmount(segs, 999)).toBe(2500);
  });
  it('first matching segment wins when ranges overlap', () => {
    const segs = [
      { startMonth: 0, endMonth: 59, monthlyAmount: 1000 },
      { startMonth: 30, endMonth: 90, monthlyAmount: 2000 },
    ];
    expect(activeContributionAmount(segs, 40)).toBe(1000);
  });
});

describe('projectScenario — contributions lever', () => {
  it('default behavior is unchanged when contributions is empty (parity)', () => {
    const baseline = projectScenario(realState, emptyLeverPayload(), { startISO: '2026-05', months: 60 });
    const empty = emptyLeverPayload();
    empty.contributions = [];
    const withEmpty = projectScenario(realState, empty, { startISO: '2026-05', months: 60 });
    for (let i = 0; i < baseline.length; i++) {
      expect(totalInvestments(withEmpty[i])).toBeCloseTo(totalInvestments(baseline[i]), 5);
      expect(withEmpty[i].cash).toBeCloseTo(baseline[i].cash, 5);
      expect(withEmpty[i].netWorth).toBeCloseTo(baseline[i].netWorth, 5);
    }
  });

  it('routes exactly $1000/mo to investments for months 0..59 regardless of income', () => {
    // With a 0% return rate (payload.returns.defaultRate = 0), zero inflation,
    // and one segment $1000/mo Y1..Y5 (startMonth=0, endMonth=59), investments
    // should grow by exactly 1000 every month for 60 months. Month 0 is the
    // seed snapshot (no contribution applied yet); contributions accrue in
    // months 1..59 → 59 increments of $1000.
    const payload = emptyLeverPayload();
    payload.returns = { defaultRate: 0, overrides: {} };
    payload.contributions = [{ startMonth: 0, endMonth: 59, monthlyAmount: 1000 }];

    const states = projectScenario(realState, payload, { startISO: '2026-05', months: 60 });
    const initial = totalInvestments(states[0]);

    // Spot-check linearity month-over-month.
    for (let i = 1; i < 60; i++) {
      expect(totalInvestments(states[i]) - totalInvestments(states[i - 1])).toBeCloseTo(1000, 5);
    }
    // Total accumulated contributions across 59 steps = 59,000.
    expect(totalInvestments(states[59]) - initial).toBeCloseTo(59 * 1000, 5);
  });

  it('routes surplus above contributions to cash', () => {
    // The household has positive after-tax savings far in excess of $500/mo;
    // with a $500/mo contribution segment and a 0% return so investments
    // change only via the contribution itself, cash must accumulate the
    // surplus (savings - 500) each month rather than the entire savings going
    // to investments.
    const payload = emptyLeverPayload();
    payload.returns = { defaultRate: 0, overrides: {} };
    payload.contributions = [{ startMonth: 0, endMonth: 11, monthlyAmount: 500 }];

    const states = projectScenario(realState, payload, { startISO: '2026-05', months: 13 });
    // After month 11, cash must be > 0 and investments must have grown by
    // exactly 11 * 500 = 5,500 from contributions (months 1..11).
    expect(totalInvestments(states[11]) - totalInvestments(states[0])).toBeCloseTo(11 * 500, 5);
    expect(states[11].cash).toBeGreaterThan(0);
  });

  it('shortfall floors cash at zero and draws remaining deficit from investments', () => {
    // Force a shortfall by configuring an absurdly large baseline expense
    // so savings is negative for the segment months. Test adjusted for the
    // cash-floor change: cash bottoms at 0 and the deficit eats investments.
    const shortfallReal: RealState = {
      ...realState,
      baselineMonthlyExpenses: 99999,
      household: { ...realState.household, monthlyExpenseBaseline: 99999 } as Household,
    };
    const payload = emptyLeverPayload();
    payload.returns = { defaultRate: 0, overrides: {} };
    payload.contributions = [{ startMonth: 0, endMonth: 11, monthlyAmount: 1000 }];

    const states = projectScenario(shortfallReal, payload, { startISO: '2026-05', months: 13 });
    // Cash floors at zero; never goes negative.
    expect(states[11].cash).toBe(0);
    // Investments are drawn down to absorb the deficit. The +1000/mo
    // contribution still routes in first, but the shortfall (savings - 1000,
    // which is very negative) hits investments after cash hits zero, so
    // investments end below their starting balance.
    expect(totalInvestments(states[11])).toBeLessThan(totalInvestments(states[0]));
  });

  it('reverts to default savings-routing after the segment ends', () => {
    // Segment covers only the first 12 months. From month 13 onward, the
    // engine should be back to "all savings → investments". The marginal
    // delta in investments between months 12→13 should jump from $1000
    // (the segment amount) back to the full savings rate, which is much
    // larger here (income ~135K/yr after tax, $4500 expenses ≈ +$3500/mo).
    const payload = emptyLeverPayload();
    payload.returns = { defaultRate: 0, overrides: {} };
    payload.contributions = [{ startMonth: 0, endMonth: 11, monthlyAmount: 1000 }];

    const states = projectScenario(realState, payload, { startISO: '2026-05', months: 24 });
    const inSegmentDelta = totalInvestments(states[11]) - totalInvestments(states[10]);
    const postSegmentDelta = totalInvestments(states[13]) - totalInvestments(states[12]);
    expect(inSegmentDelta).toBeCloseTo(1000, 5);
    expect(postSegmentDelta).toBeGreaterThan(inSegmentDelta + 100);
  });
});
