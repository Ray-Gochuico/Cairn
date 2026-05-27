import { describe, it, expect } from 'vitest';
import { projectScenario } from '@/lib/scenarios/engine';
import { emptyLeverPayload } from '@/lib/scenarios/lever-types';
import type { RealState } from '@/lib/scenarios/state-snapshot';
import type { Account } from '@/types/schema';
import type { Bracket } from '@/lib/tax';
import { AccountType } from '@/types/enums';
import { totalInvestments } from '@/lib/scenarios/aggregate-investments';

// Wave-5 Task 1 (Finance NEW-W5-1) — verifies the household-level
// `AppSettings.defaultDrawdownTaxRate` (surfaced via Settings → Advanced)
// reaches the engine via `RealState.defaults.defaultDrawdownTaxRate` and
// is used as a fallback when the per-scenario lever value is 0 (its schema
// default). Per-scenario lever value > 0 still wins as an explicit override.
//
// The shape mirrors `engine-trad-grossup.test.ts` (Sprint-4 fix) but tests
// the precedence chain rather than the math: math correctness lives there.

const federal2026Single: Bracket[] = [
  { min: 0, max: 11600, rate: 0.10 },
  { min: 11600, max: 47150, rate: 0.12 },
  { min: 47150, max: 100525, rate: 0.22 },
  { min: 100525, max: 191950, rate: 0.24 },
  { min: 191950, max: null, rate: 0.32 },
];

function tradOnlyReal(opts: {
  tradBalance: number;
  defaultDrawdownTaxRate: number | null;
}): RealState {
  const tradAccount: Account = {
    id: 1,
    householdId: 1,
    name: 'Trad 401k',
    type: AccountType.ACCOUNT_401K,
    excludedFromNetWorth: false,
  } as unknown as Account;

  return {
    accounts: [tradAccount],
    holdings: [],
    loans: [],
    loanPayments: [],
    household: { id: 1, filingStatus: 'SINGLE' } as RealState['household'],
    persons: [{
      id: 1,
      householdId: 1,
      displayName: 'A',
      annualSalaryPretax: 0,
      targetRetirementAge: 50,
      dateOfBirth: '1965-01-01',
    } as unknown as RealState['persons'][0]],
    accountsByBucket: {
      taxAdvantaged: [tradAccount],
      brokerage: [],
      cash: [],
    },
    initialCash: 0,
    initialInvestmentsByAccount: { 1: opts.tradBalance },
    cashAccountsWithBalances: [],
    defaults: {
      inflation: 0,
      returnRate: 0,
      defaultCashApy: null,
      defaultDrawdownTaxRate: opts.defaultDrawdownTaxRate,
    },
    startISO: '2026-01',
    taxBrackets: {
      federal: federal2026Single,
      state: [],
      city: null,
      ltcg: [],
      standardDeduction: { federal: 14600, state: 0, city: 0 },
    } as RealState['taxBrackets'],
  };
}

describe('engine — defaultDrawdownTaxRate fallback (Wave-5 NEW-W5-1)', () => {
  const monthlyExpense = 5000; // 60k/yr
  const horizonMonths = 13;

  it('falls back to AppSettings.defaultDrawdownTaxRate when per-scenario lever value is 0', () => {
    const real = tradOnlyReal({
      tradBalance: 1_000_000,
      defaultDrawdownTaxRate: 0.22,
    });
    const payload = emptyLeverPayload();
    payload.withdrawalStrategy = 'sequential';
    // Lever value left at schema default of 0 — engine should use the
    // household-level 0.22 fallback.
    expect(payload.effectiveDrawdownTaxRate).toBe(0);
    payload.expensePeriods = [{
      start: '2026-01-01', monthlyDelta: monthlyExpense, durationMonths: 24,
    }];
    payload.returns.defaultRate = 0;
    const states = projectScenario(real, payload, {
      startISO: '2026-01',
      months: horizonMonths,
    });
    const final = states[states.length - 1];

    // 12 months at $5k NET each, grossed up at 22% = $76,923 gross over the
    // year. Trad balance should drop from $1M to ~$923k — matching the
    // engine-trad-grossup behavior when the lever is 0.22.
    expect(totalInvestments(final)).toBeCloseTo(923_077, -3);
  });

  it('per-scenario lever value wins when set non-zero (overrides household default)', () => {
    const real = tradOnlyReal({
      tradBalance: 1_000_000,
      defaultDrawdownTaxRate: 0.22, // household default
    });
    const payload = emptyLeverPayload();
    payload.withdrawalStrategy = 'sequential';
    // Per-scenario override at a HIGHER rate than the household default —
    // engine should use 0.35, not 0.22.
    payload.effectiveDrawdownTaxRate = 0.35;
    payload.expensePeriods = [{
      start: '2026-01-01', monthlyDelta: monthlyExpense, durationMonths: 24,
    }];
    payload.returns.defaultRate = 0;
    const states = projectScenario(real, payload, {
      startISO: '2026-01',
      months: horizonMonths,
    });
    const final = states[states.length - 1];

    // 12 months at $5k NET grossed up at 35% = $5000 / 0.65 = $7,692/mo,
    // 12 × $7,692 = $92,308. Balance drops from $1M to ~$907.7k.
    expect(totalInvestments(final)).toBeCloseTo(907_692, -3);
  });

  it('no fallback when household default is null AND lever value is 0 (legacy net=gross)', () => {
    const real = tradOnlyReal({
      tradBalance: 1_000_000,
      defaultDrawdownTaxRate: null,
    });
    const payload = emptyLeverPayload();
    payload.withdrawalStrategy = 'sequential';
    // Both lever (0) and household (null) ⇒ legacy net=gross.
    payload.expensePeriods = [{
      start: '2026-01-01', monthlyDelta: monthlyExpense, durationMonths: 24,
    }];
    payload.returns.defaultRate = 0;
    const states = projectScenario(real, payload, {
      startISO: '2026-01',
      months: horizonMonths,
    });
    const final = states[states.length - 1];

    // $60k of NET-equals-gross drawdowns — balance drops to exactly $940k.
    expect(totalInvestments(final)).toBeCloseTo(940_000, -3);
    expect(final.withdrawalTaxAccrued ?? 0).toBe(0);
  });

  it('proportional strategy ignores both per-scenario AND household defaults', () => {
    const real = tradOnlyReal({
      tradBalance: 1_000_000,
      defaultDrawdownTaxRate: 0.22,
    });
    const payload = emptyLeverPayload();
    payload.withdrawalStrategy = 'proportional';
    payload.effectiveDrawdownTaxRate = 0.35;
    payload.expensePeriods = [{
      start: '2026-01-01', monthlyDelta: monthlyExpense, durationMonths: 24,
    }];
    payload.returns.defaultRate = 0;
    const states = projectScenario(real, payload, {
      startISO: '2026-01',
      months: horizonMonths,
    });
    const final = states[states.length - 1];

    // Proportional ignores both — balance drops by exactly $60k.
    expect(totalInvestments(final)).toBeCloseTo(940_000, -3);
    expect(final.withdrawalTaxAccrued ?? 0).toBe(0);
  });
});
