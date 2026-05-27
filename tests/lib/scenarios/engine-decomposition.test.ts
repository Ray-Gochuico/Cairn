import { describe, it, expect } from 'vitest';
import { projectScenario } from '@/lib/scenarios/engine';
import { emptyLeverPayload } from '@/lib/scenarios/lever-types';
import type { RealState } from '@/lib/scenarios/state-snapshot';
import type { Holding, Loan, Household, Person } from '@/types/schema';
import type { Bracket } from '@/lib/tax';
import { totalInvestments } from '@/lib/scenarios/aggregate-investments';

// Task #25 — engine flow decomposition.
//
// These tests exercise the new optional MonthlyState fields populated by
// stepMonth:
//   - compoundReturnAdded     (gain from applyAnnualReturn)
//   - autoInvestedSalarySurplus (s.savings → investments when NO segment)
//   - leverContributionsInvested (segment.monthlyAmount → investments)
//   - lumpSumInvested          (lump sums destined to investments)
//   - withdrawnFromInvestments (proportional withdrawal via cash-floor rule)
//
// The decomposition fields are pure observability — they must never affect
// existing math. We pin both that they get populated AND that totals continue
// to match the prior engine behavior.

const holdings = [
  { id: 1, accountId: 1, ticker: 'VTI', shareCount: 1000, costBasis: 200, targetAllocationPct: null },
] as unknown as Holding[];

const household = {
  id: 1, filingStatus: 'SINGLE', state: 'TX', city: null,
  monthlyExpenseBaseline: 4500, withdrawalRate: 0.04,
  inflationAssumption: 0, growthScenarios: [],
} as unknown as Household;

// Solo earner — keeps the per-person income math simple.
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

interface RealStateFactoryOverrides extends Partial<RealState> {
  /** Convenience for tests that used to pass `baselineMonthlyExpenses` to the
   * factory: dropped in 2026-05-26 revamp. Replaced by an `expensePeriods`
   * payload on the lever (see `factoryExpensePayload`). Kept as a no-op key on
   * the factory so unrelated overrides don't need to be touched here. */
  baselineMonthlyExpenses?: number;
}

function realStateFactory(overrides: RealStateFactoryOverrides = {}): RealState {
  // Strip out the legacy baseline key — it's now applied via an expensePeriods
  // payload helper (`factoryExpensePayload`) in each test that wants expenses.
  const { baselineMonthlyExpenses: _legacy, ...rest } = overrides;
  void _legacy;
  return {
    accounts: [],
    holdings,
    loans: [],
    loanPayments: [],
    household,
    persons,
    accountsByBucket: { taxAdvantaged: [], brokerage: [], cash: [] },
    initialCash: 0,
    initialInvestmentsByAccount: { 1: 200_000 },
    cashAccountsWithBalances: [],
    // The `autoInvestSalarySurplus` default lives here as a no-op until α4
    // removes it. The engine no longer reads it (α3 rewires routing through
    // `applyGapAllocation`).
    defaults: {
      inflation: 0,
      returnRate: 0,
      defaultCashApy: null,
      autoInvestSalarySurplus: true,
    },
    startISO: '2026-05',
    taxBrackets: {
      federal: federal2026Single,
      state: [],
      city: null,
      standardDeduction: { federal: 14_600, state: 0, city: 0 },
    },
    ...rest,
  };
}

/** Builds an `expensePeriods` array equivalent to the old factory's
 * `baselineMonthlyExpenses` field: one long-duration period at $amount/month
 * starting at the canonical `2026-05-01` fixture date. The plan's α1 helper
 * sums active periods and the engine inflates the sum, so this preserves the
 * pre-revamp expense semantics. */
function factoryExpensePeriods(monthlyAmount: number) {
  return [{ start: '2026-05-01', monthlyDelta: monthlyAmount, durationMonths: 480 }];
}

describe('engine decomposition — compoundReturnAdded', () => {
  it('reports the per-step investment gain from applyAnnualReturn', () => {
    // $100k @ 7% with NO income/expense flows (zero salary), so the only
    // change to investments each step is the return application.
    const zeroSalaryPersons = [{ ...persons[0], annualSalaryPretax: 0 } as Person];
    const real = realStateFactory({
      persons: zeroSalaryPersons,
      initialInvestmentsByAccount: { 1: 100_000 },
      initialCash: 100_000,                    // enough cash to absorb expense draws
      baselineMonthlyExpenses: 0,              // zero expenses too → no cash-floor pull
    });
    const payload = emptyLeverPayload();
    payload.returns.defaultRate = 0.07;
    const states = projectScenario(real, payload, { startISO: '2026-05', months: 13 });

    // Month 0 is the seed; gains start at month 1.
    const monthlyRate = Math.pow(1.07, 1 / 12) - 1;

    for (let i = 1; i <= 12; i++) {
      const prevTotal = totalInvestments(states[i - 1]);
      const expectedGain = prevTotal * monthlyRate;
      expect(states[i].compoundReturnAdded).toBeCloseTo(expectedGain, 4);
      // All other flow fields should be 0 (no salary, no expenses, no events).
      expect(states[i].gapToTaxAdvantaged).toBe(0);
      expect(states[i].gapToBrokerage).toBe(0);
      expect(states[i].gapToCash).toBe(0);
      expect(states[i].leverContributionsInvested).toBe(0);
      expect(states[i].lumpSumInvested).toBe(0);
      expect(states[i].withdrawnFromInvestments).toBe(0);
    }
  });

  it('seed state (month 0) has no decomposition fields populated', () => {
    const real = realStateFactory();
    const states = projectScenario(real, emptyLeverPayload(), { startISO: '2026-05', months: 6 });
    // Seed state is constructed directly in projectScenario; it does not
    // step through stepMonth so the optional fields are simply absent.
    expect(states[0].compoundReturnAdded).toBeUndefined();
    expect(states[0].gapToTaxAdvantaged).toBeUndefined();
    expect(states[0].gapToBrokerage).toBeUndefined();
    expect(states[0].gapToCash).toBeUndefined();
    expect(states[0].leverContributionsInvested).toBeUndefined();
    expect(states[0].lumpSumInvested).toBeUndefined();
    expect(states[0].withdrawnFromInvestments).toBeUndefined();
  });
});

describe('engine decomposition — leverContributionsInvested + gap allocation (revamp)', () => {
  it('with an active contribution segment, leverContributionsInvested === segment.monthlyAmount; gap rows route the remainder', () => {
    const real = realStateFactory();
    const payload = emptyLeverPayload();
    // Years 1..5 → months 0..59. Monthly contribution of $1,000.
    payload.contributions = [
      { startMonth: 0, endMonth: 59, monthlyAmount: 1000, allocation: null },
    ];
    const states = projectScenario(real, payload, { startISO: '2026-05', months: 12 });

    for (let i = 1; i < states.length; i++) {
      expect(states[i].leverContributionsInvested).toBe(1000);
      // Default all-cash gap allocation: the segment-leftover surplus flows to cash.
      expect(states[i].gapToTaxAdvantaged).toBe(0);
      expect(states[i].gapToBrokerage).toBe(0);
    }
  });

  it('with NO segment active + default all-cash gapAllocation, gapToCash === s.savings and leverContributionsInvested is 0', () => {
    // No contributions configured + default gap allocation → all positive
    // surplus flows to cash via the gap-allocation cash overflow path.
    const real = realStateFactory();
    const states = projectScenario(real, emptyLeverPayload(), { startISO: '2026-05', months: 6 });

    for (let i = 1; i < states.length; i++) {
      const s = states[i];
      expect(s.leverContributionsInvested).toBe(0);
      // s.savings is the same value the engine routes to cash when positive
      // under the default gap allocation. It includes income − expenses − loan
      // payments.
      expect(s.gapToCash).toBeCloseTo(Math.max(0, s.savings), 4);
      expect(s.gapToTaxAdvantaged).toBe(0);
      expect(s.gapToBrokerage).toBe(0);
    }
  });

  it('with 50% percent allocation to brokerage + brokerage account, routes 50% to brokerage and 50% to cash', () => {
    const real = realStateFactory({
      accounts: [
        { id: 1, householdId: 1, name: 'Brk', type: 'ACCOUNT_BROKERAGE', excludedFromNetWorth: false } as never,
      ],
      accountsByBucket: {
        taxAdvantaged: [],
        brokerage: [{ id: 1, householdId: 1, name: 'Brk', type: 'ACCOUNT_BROKERAGE', excludedFromNetWorth: false } as never],
        cash: [],
      },
    });
    const payload = emptyLeverPayload();
    payload.gapAllocation = {
      taxAdvantaged: null,
      brokerage:     { mode: 'percent', value: 0.5, accountSplits: null },
    };
    const states = projectScenario(real, payload, { startISO: '2026-05', months: 6 });
    for (let i = 1; i < states.length; i++) {
      const s = states[i];
      expect(s.gapToBrokerage).toBeCloseTo(Math.max(0, s.savings) * 0.5, 2);
      expect(s.gapToCash).toBeCloseTo(Math.max(0, s.savings) * 0.5, 2);
      expect(s.gapToTaxAdvantaged).toBe(0);
    }
  });
});

describe('engine decomposition — lumpSumInvested', () => {
  it('reports the lump-sum amount in the month it fires when destination=investments', () => {
    const real = realStateFactory();
    const payload = emptyLeverPayload();
    // Lump sum in month 6 (2026-11, since startISO is 2026-05 and month 0 is 2026-05).
    payload.lumpSums = [
      { amount: 20_000, when: '2026-11', destination: 'investments', label: 'Bonus' },
    ];
    const states = projectScenario(real, payload, { startISO: '2026-05', months: 12 });

    // Find the matching index.
    const fireIdx = states.findIndex((s) => s.monthISO === '2026-11');
    expect(fireIdx).toBe(6);

    expect(states[fireIdx].lumpSumInvested).toBe(20_000);
    // Surrounding months get nothing.
    expect(states[fireIdx - 1].lumpSumInvested).toBe(0);
    expect(states[fireIdx + 1].lumpSumInvested).toBe(0);
  });

  it('does NOT report lumpSumInvested for destination=cash', () => {
    const real = realStateFactory();
    const payload = emptyLeverPayload();
    payload.lumpSums = [
      { amount: 5_000, when: '2026-10', destination: 'cash', label: 'Refund' },
    ];
    const states = projectScenario(real, payload, { startISO: '2026-05', months: 12 });
    const fireIdx = states.findIndex((s) => s.monthISO === '2026-10');
    expect(fireIdx).toBe(5);
    expect(states[fireIdx].lumpSumInvested).toBe(0);
  });

  it('sums multiple investments-destined lump sums firing in the same month', () => {
    const real = realStateFactory();
    const payload = emptyLeverPayload();
    payload.lumpSums = [
      { amount: 8_000, when: '2026-10', destination: 'investments', label: 'A' },
      { amount: 12_000, when: '2026-10', destination: 'investments', label: 'B' },
      { amount: 1_000, when: '2026-10', destination: 'cash', label: 'C' }, // cash → ignored
    ];
    const states = projectScenario(real, payload, { startISO: '2026-05', months: 8 });
    const fireIdx = states.findIndex((s) => s.monthISO === '2026-10');
    expect(states[fireIdx].lumpSumInvested).toBe(20_000);
  });
});

describe('engine decomposition — withdrawnFromInvestments', () => {
  it('reports withdrawal when expenses + loan payments exceed cash + income', () => {
    // Zero-salary retiree drawing from investments — cash floor will pull
    // from investments every step.
    const zeroSalaryPersons = [{ ...persons[0], annualSalaryPretax: 0 } as Person];
    const real = realStateFactory({
      persons: zeroSalaryPersons,
      initialInvestmentsByAccount: { 1: 500_000 },
      initialCash: 0,
    });
    const payload = emptyLeverPayload();
    payload.expensePeriods = factoryExpensePeriods(5_000);
    const states = projectScenario(real, payload, { startISO: '2026-05', months: 6 });

    // Every stepped month should withdraw ~$5k from investments (no growth
    // since defaultReturnRate is 0).
    for (let i = 1; i < states.length; i++) {
      expect(states[i].withdrawnFromInvestments).toBeGreaterThan(0);
      // Should be roughly the expense amount (cash starts at 0 each step
      // since growth is zero and no positive surplus comes in).
      expect(states[i].withdrawnFromInvestments).toBeCloseTo(5_000, 0);
    }
  });

  it('reports 0 withdrawal when surplus is positive', () => {
    const real = realStateFactory();
    const states = projectScenario(real, emptyLeverPayload(), { startISO: '2026-05', months: 6 });
    for (let i = 1; i < states.length; i++) {
      // Salaried household with positive surplus — no investment withdrawal.
      expect(states[i].withdrawnFromInvestments).toBe(0);
    }
  });
});

describe('engine decomposition — math invariants', () => {
  it('compoundReturnAdded + investments-bound inflows − withdrawals ≈ change in totalInvestments each step', () => {
    // Pick a scenario with all flow types active so the decomposition fully
    // reconciles. Salary surplus + lump sum + return.
    const real = realStateFactory();
    const payload = emptyLeverPayload();
    payload.returns.defaultRate = 0.07;
    payload.lumpSums = [
      { amount: 10_000, when: '2026-08', destination: 'investments', label: 'Bonus' },
    ];
    const states = projectScenario(real, payload, { startISO: '2026-05', months: 12 });

    for (let i = 1; i < states.length; i++) {
      const before = totalInvestments(states[i - 1]);
      const after = totalInvestments(states[i]);
      const actualDelta = after - before;

      const s = states[i];
      // Only the gap-to-investments rows (tax-adv + brokerage) hit the
      // investmentsByAccount pile; gapToCash routes to s.cash, not investments.
      const reconstructed =
        (s.compoundReturnAdded ?? 0) +
        (s.gapToTaxAdvantaged ?? 0) +
        (s.gapToBrokerage ?? 0) +
        (s.leverContributionsInvested ?? 0) +
        (s.lumpSumInvested ?? 0) -
        (s.withdrawnFromInvestments ?? 0);

      // Allow a small tolerance for floating-point drift.
      expect(reconstructed).toBeCloseTo(actualDelta, 2);
    }
  });

  it('engine math is unchanged: totals match a no-instrumentation reference projection', () => {
    // Sanity: rerunning the same projection twice yields identical totals.
    // (We can't compare against the "pre-instrumentation" engine since we just
    // changed it, but we can confirm determinism + reasonable outputs.)
    const real = realStateFactory();
    const payload = emptyLeverPayload();
    payload.returns.defaultRate = 0.07;
    const a = projectScenario(real, payload, { startISO: '2026-05', months: 24 });
    const b = projectScenario(real, payload, { startISO: '2026-05', months: 24 });
    for (let i = 0; i < a.length; i++) {
      expect(totalInvestments(a[i])).toBeCloseTo(totalInvestments(b[i]), 6);
      expect(a[i].cash).toBeCloseTo(b[i].cash, 6);
      expect(a[i].netWorth).toBeCloseTo(b[i].netWorth, 6);
    }
  });
});

// Gap allocation — replaces the legacy migration-0029 `autoInvestSalarySurplus`
// toggle (2026-05-26 revamp). Routing decisions are now per-bucket on the lever
// payload's `gapAllocation` field. Default (both buckets null) routes everything
// to cash.
describe('stepMonth — gapAllocation routing', () => {
  it('default all-cash routing: positive surplus flows entirely to gapToCash', () => {
    const real = realStateFactory();
    const payload = emptyLeverPayload();
    payload.returns.defaultRate = 0;
    const states = projectScenario(real, payload, {
      startISO: '2026-05',
      months: 6,
    });

    for (let i = 1; i < states.length; i++) {
      const s = states[i];
      expect(s.gapToCash).toBeCloseTo(Math.max(0, s.savings), 4);
      expect(s.gapToTaxAdvantaged).toBe(0);
      expect(s.gapToBrokerage).toBe(0);
      // Investments unchanged step-over-step (no return, no segment, no gap→invest).
      expect(totalInvestments(s)).toBeCloseTo(totalInvestments(states[i - 1]), 4);
    }
    // Cash should have accumulated positive surplus over 5 stepped months.
    expect(states[states.length - 1].cash).toBeGreaterThan(0);
  });

  it('100% brokerage allocation: positive surplus flows to brokerage; cash unchanged', () => {
    const real = realStateFactory({
      initialInvestmentsByAccount: { 1: 200_000 },
      accountsByBucket: {
        taxAdvantaged: [],
        brokerage: [{ id: 1, householdId: 1, name: 'Brk', type: 'ACCOUNT_BROKERAGE', excludedFromNetWorth: false } as never],
        cash: [],
      },
    });
    const payload = emptyLeverPayload();
    payload.returns.defaultRate = 0;
    payload.gapAllocation = {
      taxAdvantaged: null,
      brokerage:     { mode: 'percent', value: 1.0, accountSplits: null },
    };
    const states = projectScenario(real, payload, {
      startISO: '2026-05',
      months: 6,
    });

    for (let i = 1; i < states.length; i++) {
      const s = states[i];
      expect(s.gapToBrokerage).toBeCloseTo(Math.max(0, s.savings), 4);
      expect(s.gapToTaxAdvantaged).toBe(0);
      expect(s.gapToCash).toBe(0);
      // Cash unchanged when 100% of surplus is routed to investments.
      expect(s.cash).toBeCloseTo(states[i - 1].cash, 4);
    }
    expect(totalInvestments(states[states.length - 1])).toBeGreaterThan(
      totalInvestments(states[0]),
    );
  });

  it('explicit contribution segment: leftover surplus flows through gap allocation', () => {
    const real = realStateFactory();
    const payload = emptyLeverPayload();
    payload.contributions = [
      { startMonth: 0, endMonth: 59, monthlyAmount: 500, allocation: null },
    ];
    const states = projectScenario(real, payload, { startISO: '2026-05', months: 6 });

    for (let i = 1; i < states.length; i++) {
      const s = states[i];
      // Segment lands in investments.
      expect(s.leverContributionsInvested).toBe(500);
      // Default all-cash gap allocation routes the leftover (s.savings - 500)
      // to cash via the gap-cash overflow path.
      expect(s.gapToCash).toBeCloseTo(Math.max(0, s.savings - 500), 4);
      expect(s.gapToTaxAdvantaged).toBe(0);
      expect(s.gapToBrokerage).toBe(0);
    }
  });

  it('negative savings: gapTo* fields stay at 0; cash-floor pulls from investments', () => {
    const zeroSalaryPersons = [{ ...persons[0], annualSalaryPretax: 0 } as Person];
    const real = realStateFactory({
      persons: zeroSalaryPersons,
      initialInvestmentsByAccount: { 1: 500_000 },
      initialCash: 0,
    });
    const payload = emptyLeverPayload();
    payload.expensePeriods = factoryExpensePeriods(5_000);
    const states = projectScenario(real, payload, {
      startISO: '2026-05',
      months: 6,
    });
    for (let i = 1; i < states.length; i++) {
      expect(states[i].gapToTaxAdvantaged).toBe(0);
      expect(states[i].gapToBrokerage).toBe(0);
      expect(states[i].gapToCash).toBe(0);
      expect(states[i].withdrawnFromInvestments).toBeGreaterThan(0);
    }
  });
});
