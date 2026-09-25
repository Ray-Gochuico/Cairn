import { describe, it, expect } from 'vitest';
import { detectMilestones, projectionSpending, type FinancialIndependenceParams } from '@/lib/scenarios/milestones';
import type { MonthlyState } from '@/lib/scenarios/engine';

function buildStates(values: Array<{
  month: string;
  netWorth: number;
  debt: number;
  expenses: number;
  /** Optional override: liquid (investments + cash). Defaults to netWorth + debt
   *  (i.e. all of net-worth is held as liquid). Pass an explicit value when
   *  testing the home-equity-inflation fix (Wave-3 Task 4). */
  liquid?: number;
  /** Optional home-equity overlay. Defaults to 0. */
  homeEquity?: number;
  /** C2 review: the engine's per-month AUTHORED stamp (MonthlyState.authoredExpenses).
   *  Omitted → the state carries no stamp (a hand-built / pre-C2 shape). */
  authored?: number;
}>): MonthlyState[] {
  return values.map((v) => {
    const investments = v.liquid ?? v.netWorth + v.debt;
    return {
      monthISO: v.month,
      investmentsByAccount: investments > 0 ? { 1: investments } : {},
      homeEquity: v.homeEquity ?? 0,
      cash: 0,
      debtByLoan: v.debt > 0 ? { 1: v.debt } : {},
      netWorth: v.netWorth, incomeAfterTax: 0, expenses: v.expenses, savings: 0, events: [],
      ...(v.authored !== undefined ? { authoredExpenses: v.authored } : {}),
    };
  });
}

describe('detectMilestones', () => {
  const fiParams: FinancialIndependenceParams = { withdrawalRate: 0.04 };

  it('finds debt-free month (first month with zero total debt)', () => {
    const states = buildStates([
      { month: '2026-05', netWorth: 100000, debt: 18000, expenses: 4000 },
      { month: '2026-06', netWorth: 102000, debt: 17000, expenses: 4000 },
      { month: '2029-06', netWorth: 220000, debt: 0,     expenses: 4000 },
    ]);
    expect(detectMilestones(states, fiParams).debtFreeISO).toBe('2029-06');
  });

  it('finds Financial Independence month (first month where net worth × withdrawalRate / 12 ≥ monthly expenses)', () => {
    const states = buildStates([
      { month: '2030-01', netWorth: 500000,  debt: 0, expenses: 4000 },
      { month: '2035-01', netWorth: 1100000, debt: 0, expenses: 4000 },
      { month: '2040-01', netWorth: 1300000, debt: 0, expenses: 4000 },
    ]);
    // 4% of 1.1M = 44K/yr = 3,666/mo < 4000 expenses; 4% of 1.3M = 52K/yr = 4,333/mo ≥ 4000
    expect(detectMilestones(states, fiParams).financialIndependenceISO).toBe('2040-01');
  });

  it('returns undefined fields when milestones are never reached', () => {
    const states = buildStates([
      { month: '2026-05', netWorth: 100000, debt: 18000, expenses: 4000 },
      { month: '2056-05', netWorth: 110000, debt: 12000, expenses: 4000 },
    ]);
    const m = detectMilestones(states, fiParams);
    expect(m.debtFreeISO).toBeUndefined();
    expect(m.financialIndependenceISO).toBeUndefined();
  });

  it('reports netWorth30y as the net worth at month index 359 when the horizon is at least 360 months', () => {
    const states: MonthlyState[] = [];
    for (let i = 0; i < 400; i++) {
      states.push({
        monthISO: '2026-01',
        investmentsByAccount: {},
        homeEquity: 0,
        cash: 0,
        debtByLoan: {},
        netWorth: 1000 + i,
        incomeAfterTax: 0,
        expenses: 0,
        savings: 0,
        events: [],
      });
    }
    expect(detectMilestones(states, fiParams).netWorth30y).toBe(1000 + 359);
  });

  it('falls back to the final state net worth when fewer than 30 years of states are available', () => {
    const states = buildStates([
      { month: '2026-05', netWorth: 100000, debt: 0, expenses: 4000 },
      { month: '2026-06', netWorth: 200000, debt: 0, expenses: 4000 },
    ]);
    expect(detectMilestones(states, fiParams).netWorth30y).toBe(200000);
  });

  it('returns undefined netWorth30y when given an empty state list', () => {
    expect(detectMilestones([], fiParams).netWorth30y).toBeUndefined();
  });

  it('detects the retirement month (first month where incomeAfterTax transitions to 0)', () => {
    const states: MonthlyState[] = [
      { monthISO: '2026-05', investmentsByAccount: {}, homeEquity: 0, cash: 0, debtByLoan: {}, netWorth: 0, incomeAfterTax: 8000, expenses: 4000, savings: 4000, events: [] },
      { monthISO: '2026-06', investmentsByAccount: {}, homeEquity: 0, cash: 0, debtByLoan: {}, netWorth: 0, incomeAfterTax: 8000, expenses: 4000, savings: 4000, events: [] },
      { monthISO: '2031-06', investmentsByAccount: {}, homeEquity: 0, cash: 0, debtByLoan: {}, netWorth: 0, incomeAfterTax: 0,    expenses: 4000, savings: -4000, events: [] },
      { monthISO: '2031-07', investmentsByAccount: {}, homeEquity: 0, cash: 0, debtByLoan: {}, netWorth: 0, incomeAfterTax: 0,    expenses: 4000, savings: -4000, events: [] },
    ];
    expect(detectMilestones(states, fiParams).retirementISO).toBe('2031-06');
  });

  it('returns undefined retirementISO when income never transitions to zero', () => {
    const states: MonthlyState[] = [
      { monthISO: '2026-05', investmentsByAccount: {}, homeEquity: 0, cash: 0, debtByLoan: {}, netWorth: 0, incomeAfterTax: 8000, expenses: 4000, savings: 4000, events: [] },
      { monthISO: '2026-06', investmentsByAccount: {}, homeEquity: 0, cash: 0, debtByLoan: {}, netWorth: 0, incomeAfterTax: 8000, expenses: 4000, savings: 4000, events: [] },
    ];
    expect(detectMilestones(states, fiParams).retirementISO).toBeUndefined();
  });

  // ----- Round-3 M2 — zero expense baseline yields NO FI milestone ----------
  describe('zero expense baseline (round-3 M2)', () => {
    // High liquid vs tiny per-month expenses (e.g. loan payments with a $0
    // baseline): the crossing scan fires on month one, claiming instant FI.
    const states = buildStates([
      { month: '2026-01', netWorth: 500_000, debt: 0, expenses: 500, liquid: 500_000 },
      { month: '2026-02', netWorth: 505_000, debt: 0, expenses: 500, liquid: 505_000 },
    ]);

    it('FI milestone is undefined when the expense baseline is zero', () => {
      // A $0 target is trivially "reached" at month 0 — that's a missing input,
      // not an achievement. The milestone must be absent so chips render "FI —".
      const m = detectMilestones(states, { withdrawalRate: 0.04, monthlyExpenseBaseline: 0 });
      expect(m.financialIndependenceISO).toBeUndefined();
    });

    it('a positive baseline keeps the existing crossing behavior', () => {
      const m = detectMilestones(states, { withdrawalRate: 0.04, monthlyExpenseBaseline: 4000 });
      expect(m.financialIndependenceISO).toBe('2026-01'); // 500k × 4% / 12 ≈ $1,667 ≥ $500
    });
  });

  // ----- C2 — the SCENARIO's authored expense gate (sibling of M2), PER MONTH ----------
  describe('zero authored scenario expense (C2) — gated per month on the engine\'s own stamp', () => {
    // The hazard: a household with rent on file and a scenario whose authored
    // expense is $0 (custom/0, or a data mode with no complete month). The
    // engine's `expenses` is the rent alone (> 0), the household baseline is
    // set (> 0), so M2 is open and the crossing fires on month one against
    // rent — "FI next month". Seeded repro: FI 2026-08 (sample-profile.test).
    // C2 review: the gate reads the engine's per-month stamp
    // (MonthlyState.authoredExpenses: base + the periods it applies THAT month,
    // obligations excluded), so a period that ends, starts mid-month or starts
    // later is judged exactly as the engine spends it.
    const rentOnly = buildStates([
      { month: '2026-07', netWorth: 947_000, debt: 0, expenses: 2_505, liquid: 947_000, authored: 0 },
      { month: '2026-08', netWorth: 950_000, debt: 0, expenses: 2_510, liquid: 950_000, authored: 0 },
    ]);
    const authoring = buildStates([
      { month: '2026-07', netWorth: 947_000, debt: 0, expenses: 2_505, liquid: 947_000, authored: 5_911.12 },
      { month: '2026-08', netWorth: 950_000, debt: 0, expenses: 2_510, liquid: 950_000, authored: 5_911.12 },
    ]);

    it('a $0 authored expense gates the FI scan OFF even though engine expenses are > 0 (rent) and the household baseline is set', () => {
      const m = detectMilestones(rentOnly, { withdrawalRate: 0.04, monthlyExpenseBaseline: 6_000 });
      expect(m.financialIndependenceISO).toBeUndefined();
      expect(m.debtFreeISO).toBe('2026-07');                              // the other milestones are untouched
    });

    it('a positive authored expense keeps the crossing behavior', () => {
      const m = detectMilestones(authoring, { withdrawalRate: 0.04, monthlyExpenseBaseline: 6_000 });
      expect(m.financialIndependenceISO).toBe('2026-07');                 // 947k × 4% / 12 ≈ $3,157 ≥ $2,505
    });

    it('no stamp → legacy behavior (hand-built states and callers outside the engine are not gated)', () => {
      const unstamped = buildStates([
        { month: '2026-07', netWorth: 947_000, debt: 0, expenses: 2_505, liquid: 947_000 },
      ]);
      expect(detectMilestones(unstamped, { withdrawalRate: 0.04, monthlyExpenseBaseline: 6_000 }).financialIndependenceISO).toBe('2026-07');
    });

    it('BOTH gates hold: a $0 household baseline with a positive authored expense still reads no FI (G1 and the FI cards keep saying why)', () => {
      const m = detectMilestones(authoring, { withdrawalRate: 0.04, monthlyExpenseBaseline: 0 });
      expect(m.financialIndependenceISO).toBeUndefined();
    });

    it('UPHELD 0 — a period that ENDS: no crossing in the months after it, where the spending is rent alone', () => {
      // A $0 base + a big 2-month period: liquid cannot cover it while it runs,
      // then the engine spends rent alone — the shipped month-0 gate read FI here.
      const states = buildStates([
        { month: '2026-07', netWorth: 947_000, debt: 0, expenses: 0,      liquid: 947_000, authored: 0 },
        { month: '2026-08', netWorth: 930_000, debt: 0, expenses: 22_505, liquid: 930_000, authored: 20_000 },
        { month: '2026-09', netWorth: 910_000, debt: 0, expenses: 22_510, liquid: 910_000, authored: 20_000 },
        { month: '2026-10', netWorth: 911_000, debt: 0, expenses: 2_515,  liquid: 911_000, authored: 0 },
        { month: '2026-11', netWorth: 912_000, debt: 0, expenses: 2_520,  liquid: 912_000, authored: 0 },
      ]);
      expect(detectMilestones(states, { withdrawalRate: 0.04, monthlyExpenseBaseline: 6_000 }).financialIndependenceISO).toBeUndefined();
    });

    it('MINOR 0 — a period that starts LATER: no FI on rent alone before it; FI can land on its first authored month', () => {
      const states = buildStates([
        { month: '2026-07', netWorth: 947_000, debt: 0, expenses: 0,     liquid: 947_000, authored: 0 },
        { month: '2026-08', netWorth: 950_000, debt: 0, expenses: 2_505, liquid: 950_000, authored: 0 },
        { month: '2026-09', netWorth: 953_000, debt: 0, expenses: 3_005, liquid: 953_000, authored: 500 },
      ]);
      expect(detectMilestones(states, { withdrawalRate: 0.04, monthlyExpenseBaseline: 6_000 }).financialIndependenceISO).toBe('2026-09');
    });

    it('the gate is per MONTH, not per projection: month 1 authoring does not open the months after it', () => {
      // The month-0/first-month mutant: judge the whole horizon by one month.
      const states = buildStates([
        { month: '2026-07', netWorth: 100_000, debt: 0, expenses: 0,     liquid: 100_000, authored: 0 },
        { month: '2026-08', netWorth: 100_000, debt: 0, expenses: 9_000, liquid: 100_000, authored: 6_500 },
        { month: '2026-09', netWorth: 947_000, debt: 0, expenses: 2_505, liquid: 947_000, authored: 0 },
      ]);
      expect(detectMilestones(states, { withdrawalRate: 0.04, monthlyExpenseBaseline: 6_000 }).financialIndependenceISO).toBeUndefined();
      // … and a first month authoring $0 does not close the months after it
      const later = buildStates([
        { month: '2026-07', netWorth: 947_000, debt: 0, expenses: 0,     liquid: 947_000, authored: 0 },
        { month: '2026-08', netWorth: 947_000, debt: 0, expenses: 2_505, liquid: 947_000, authored: 0 },
        { month: '2026-09', netWorth: 947_000, debt: 0, expenses: 3_005, liquid: 947_000, authored: 500 },
      ]);
      expect(detectMilestones(later, { withdrawalRate: 0.04, monthlyExpenseBaseline: 6_000 }).financialIndependenceISO).toBe('2026-09');
    });
  });

  // ----- C2 review — G11's two facts about ONE scenario's projection ----------
  describe('projectionSpending — read off the engine\'s per-month stamp, the FI gate\'s own predicate', () => {
    it('authors spending when ANY month\'s stamp is > 0 (a future start, a period that ends)', () => {
      expect(projectionSpending(buildStates([
        { month: '2026-07', netWorth: 1, debt: 0, expenses: 0, authored: 0 },
        { month: '2026-08', netWorth: 1, debt: 0, expenses: 2_500, authored: 0 },
        { month: '2026-09', netWorth: 1, debt: 0, expenses: 5_500, authored: 3_000 },
      ]))).toEqual({ authorsSpending: true, spendsAnything: true });
    });

    it('$0 authored in EVERY month with rent spent → spends, authors nothing (the rent variant)', () => {
      expect(projectionSpending(buildStates([
        { month: '2026-07', netWorth: 1, debt: 0, expenses: 0, authored: 0 },
        { month: '2026-08', netWorth: 1, debt: 0, expenses: 2_500, authored: 0 },
        { month: '2026-09', netWorth: 1, debt: 0, expenses: 2_505, authored: 0 },
      ]))).toEqual({ authorsSpending: false, spendsAnything: true });
    });

    it('nothing on file → nothing spent in any month (the "nothing is spent" variant)', () => {
      expect(projectionSpending(buildStates([
        { month: '2026-07', netWorth: 1, debt: 0, expenses: 0, authored: 0 },
        { month: '2026-08', netWorth: 1, debt: 0, expenses: 0, authored: 0 },
      ]))).toEqual({ authorsSpending: false, spendsAnything: false });
    });

    it('unstamped states (hand-built / pre-C2) are never claimed to author nothing', () => {
      expect(projectionSpending(buildStates([
        { month: '2026-07', netWorth: 1, debt: 0, expenses: 0 },
      ])).authorsSpending).toBe(true);
    });
  });

  // ----- Wave-3 Task 4 — FI milestone uses LIQUID, not net worth ------------
  describe('FI milestone uses liquid (investments + cash), excludes home equity', () => {
    it('a $1M home owner with $0 investments NEVER reaches FI by the 4% rule', () => {
      // Pre-fix: netWorth = 1M home equity → 1M * 4% / 12 = $3,333/mo, which
      // crosses an expense floor of $3k. The user "reaches FI" — clearly
      // wrong since they cannot actually draw 4% from their home.
      const states = buildStates([
        { month: '2026-01', netWorth: 1_000_000, debt: 0, expenses: 3_000, liquid: 0, homeEquity: 1_000_000 },
        { month: '2026-06', netWorth: 1_000_000, debt: 0, expenses: 3_000, liquid: 0, homeEquity: 1_000_000 },
      ]);
      // Post-fix: liquid = 0, so FI is never reached.
      expect(detectMilestones(states, fiParams).financialIndependenceISO).toBeUndefined();
    });

    it('homeowner with $900k investments + $1M home equity still reaches FI at the right month', () => {
      // 900k * 4% = 36k/yr = 3k/mo — exactly hits the expense floor.
      // The pre-fix calculation would have crossed FI much earlier (with
      // any investments + 1M home equity inflating the SWR pool).
      const states = buildStates([
        { month: '2026-01', netWorth: 500_000,   debt: 0, expenses: 3_000, liquid: 0,       homeEquity: 1_000_000 },
        { month: '2030-01', netWorth: 1_400_000, debt: 0, expenses: 3_000, liquid: 400_000, homeEquity: 1_000_000 },
        { month: '2040-01', netWorth: 1_900_000, debt: 0, expenses: 3_000, liquid: 900_000, homeEquity: 1_000_000 },
      ]);
      expect(detectMilestones(states, fiParams).financialIndependenceISO).toBe('2040-01');
    });
  });
});
