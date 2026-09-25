import { describe, it, expect } from 'vitest';
import { toReal } from '@/lib/scenarios/real';
import { totalInvestments } from '@/lib/scenarios/aggregate-investments';
import type { MonthlyState } from '@/lib/scenarios/engine';

const make = (monthISO: string, invest: number): MonthlyState => ({
  monthISO,
  investmentsByAccount: { 1: invest },
  homeEquity: 0,
  cash: 0,
  debtByLoan: {},
  netWorth: invest,
  incomeAfterTax: 0,
  expenses: 0,
  savings: 0,
  events: [],
});

describe('toReal', () => {
  it('discounts dollar fields by inflation across years elapsed', () => {
    const states = [make('2026-05', 100000), make('2027-05', 100000)];
    const real = toReal(states, 0.025, '2026-05');
    expect(totalInvestments(real[0])).toBeCloseTo(100000, 0);
    expect(totalInvestments(real[1])).toBeCloseTo(100000 / 1.025, 0);
  });

  it('leaves debtByLoan as objects and discounts each entry', () => {
    const s: MonthlyState = { ...make('2027-05', 100000), debtByLoan: { 1: 50000 } };
    const real = toReal([s], 0.025, '2026-05');
    expect(real[0].debtByLoan[1]).toBeCloseTo(50000 / 1.025, 0);
  });

  it('does not mutate the input', () => {
    const states = [make('2027-05', 100000)];
    toReal(states, 0.025, '2026-05');
    expect(totalInvestments(states[0])).toBe(100000);
  });

  it('scales gapToTaxAdvantaged + gapToBrokerage + gapToCash by the inflation factor (2026-05-26 revamp)', () => {
    // Mirror the existing decomposition-field scaling: nominal $/step amounts
    // are deflated by the same per-step factor as cash / investments. After
    // 1 year @ 3% inflation, $1000 nominal ≈ $970.87 real (1 / 1.03).
    const states: MonthlyState[] = [
      { ...make('2026-05', 100_000), gapToTaxAdvantaged: 0, gapToBrokerage: 0, gapToCash: 0 },
      {
        ...make('2027-05', 100_000),
        gapToTaxAdvantaged: 1000,
        gapToBrokerage: 500,
        gapToCash: 250,
      },
    ];
    const realStates = toReal(states, 0.03, '2026-05');
    expect(realStates[1].gapToTaxAdvantaged).toBeCloseTo(1000 / 1.03, 2);
    expect(realStates[1].gapToBrokerage).toBeCloseTo(500 / 1.03, 2);
    expect(realStates[1].gapToCash).toBeCloseTo(250 / 1.03, 2);
    // Month 0 explicit zeros stay at zero (preserved through the scale).
    expect(realStates[0].gapToTaxAdvantaged).toBe(0);
    expect(realStates[0].gapToBrokerage).toBe(0);
    expect(realStates[0].gapToCash).toBe(0);
  });

  it('preserves undefined gapTo* fields distinctly from 0', () => {
    // Seed state (month 0) doesn't step through stepMonth → fields are
    // undefined, not 0. toReal must keep that distinction so tooltips don't
    // render a row for a state that never ran the gap-allocation branch.
    const states: MonthlyState[] = [make('2027-05', 100_000)];
    const realStates = toReal(states, 0.03, '2026-05');
    expect(realStates[0].gapToTaxAdvantaged).toBeUndefined();
    expect(realStates[0].gapToBrokerage).toBeUndefined();
    expect(realStates[0].gapToCash).toBeUndefined();
  });

  // C1 (W3 chip c / D-C1-7): withdrawalTaxAccrued was the one per-step dollar
  // flow toReal skipped. It resets to 0 every step (engine.ts:474) and
  // accumulates within the step (engine.ts:754), so the month's factor is the
  // right one — the same treatment as withdrawnFromInvestments beside it.
  it('scales withdrawalTaxAccrued by the same factor as its sibling withdrawnFromInvestments', () => {
    const states: MonthlyState[] = [
      { ...make('2026-05', 100_000), withdrawalTaxAccrued: 0 },
      { ...make('2027-05', 100_000), withdrawalTaxAccrued: 1000, withdrawnFromInvestments: 4000 },
    ];
    const real = toReal(states, 0.03, '2026-05');
    expect(real[1].withdrawalTaxAccrued).toBeCloseTo(1000 / 1.03, 2);
    expect(real[1].withdrawnFromInvestments).toBeCloseTo(4000 / 1.03, 2);
    expect(real[0].withdrawalTaxAccrued).toBe(0);
  });

  it('preserves an undefined withdrawalTaxAccrued (seed month) distinctly from 0', () => {
    expect(toReal([make('2027-05', 1)], 0.03, '2026-05')[0].withdrawalTaxAccrued).toBeUndefined();
  });

  it('COMPLETENESS: every optional per-step flow the engine resets (engine.ts:467-474) is scaled — add a new one here AND to toReal', () => {
    const FLOWS = [
      'compoundReturnAdded', 'gapToTaxAdvantaged', 'gapToBrokerage', 'gapToCash',
      'leverContributionsInvested', 'lumpSumInvested', 'withdrawnFromInvestments', 'withdrawalTaxAccrued',
    ] as const;
    const s: MonthlyState = { ...make('2027-05', 100_000), ...Object.fromEntries(FLOWS.map((f) => [f, 100])) };
    const real = toReal([s], 0.03, '2026-05')[0];
    for (const f of FLOWS) expect(real[f], f).toBeCloseTo(100 / 1.03, 6);
  });

  // C2 review: the engine's per-month AUTHORED stamp is nominal like `expenses`
  // (the authored share of it), so the today's-dollar view deflates it by the
  // same factor — never a nominal figure inside a real-dollar map.
  it('deflates authoredExpenses exactly like expenses; an absent stamp stays absent', () => {
    const s: MonthlyState = { ...make('2027-05', 1), expenses: 5_150, authoredExpenses: 2_575 };
    const real = toReal([s], 0.03, '2026-05')[0];
    expect(real.expenses).toBeCloseTo(5_000, 6);
    expect(real.authoredExpenses).toBeCloseTo(2_500, 6);
    expect(toReal([make('2027-05', 1)], 0.03, '2026-05')[0].authoredExpenses).toBeUndefined();
  });
});
