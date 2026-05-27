import { describe, it, expect } from 'vitest';
import { projectScenario } from '@/lib/scenarios/engine';
import { emptyLeverPayload } from '@/lib/scenarios/lever-types';
import type { RealState } from '@/lib/scenarios/state-snapshot';
import type { Account } from '@/types/schema';
import type { Bracket } from '@/lib/tax';
import { AccountType } from '@/types/enums';
import { totalInvestments } from '@/lib/scenarios/aggregate-investments';

// -----------------------------------------------------------------------------
// Wave-3 Task 2 — verify the engine grosses up sequential withdrawals from the
// taxDeferred (Trad 401k / Trad IRA / HSA / 529) bucket so the NET cash
// delivered to the user equals their requested deficit. Pre-fix the engine
// treated all sequential draws as net-to-user; a 100%-Trad retiree pulling
// $60k/yr for expenses needed to actually withdraw ~$76.9k pre-tax at a 22%
// effective rate. This 22% gap × 30 years × ~$1M Trad balance compounds into
// a ~$200-300k ending-balance over-statement.
// -----------------------------------------------------------------------------

const federal2026Single: Bracket[] = [
  { min: 0, max: 11600, rate: 0.10 },
  { min: 11600, max: 47150, rate: 0.12 },
  { min: 47150, max: 100525, rate: 0.22 },
  { min: 100525, max: 191950, rate: 0.24 },
  { min: 191950, max: null, rate: 0.32 },
];

function tradOnlyReal(opts: { tradBalance: number }): RealState {
  const tradAccount: Account = {
    id: 1, householdId: 1,
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
      id: 1, householdId: 1, displayName: 'A',
      annualSalaryPretax: 0,                  // already retired
      targetRetirementAge: 50,
      dateOfBirth: '1965-01-01',              // age ~60 at 2026 start
    } as unknown as RealState['persons'][0]],
    accountsByBucket: {
      taxAdvantaged: [tradAccount],
      brokerage: [],
      cash: [],
    },
    initialCash: 0,
    initialInvestmentsByAccount: { 1: opts.tradBalance },
    cashAccountsWithBalances: [],
    defaults: { inflation: 0, returnRate: 0, defaultCashApy: null },
    startISO: '2026-01',
    taxBrackets: {
      federal: federal2026Single,
      state: [],
      city: null,
      standardDeduction: { federal: 14600, state: 0, city: 0 },
    } as RealState['taxBrackets'],
  };
}

describe('engine — Trad-bucket gross-up (Wave-3 Task 2)', () => {
  const monthlyExpense = 5000;          // 60k/yr expenses
  const horizonMonths = 13;             // ~1 year to validate annual gross-up

  it('sequential strategy with effectiveDrawdownTaxRate=0 keeps legacy net=gross behavior', () => {
    const real = tradOnlyReal({ tradBalance: 1_000_000 });
    const payload = emptyLeverPayload();
    payload.withdrawalStrategy = 'sequential';
    payload.expensePeriods = [{
      start: '2026-01-01', monthlyDelta: monthlyExpense, durationMonths: 24,
    }];
    payload.returns.defaultRate = 0;
    const states = projectScenario(real, payload, { startISO: '2026-01', months: horizonMonths });
    const final = states[states.length - 1];
    // 12 months of $5k expense draws = $60k net. With rate=0, gross = net,
    // so the Trad bucket should be down by $60k.
    expect(totalInvestments(final)).toBeCloseTo(940_000, -3);   // ±$1k
    expect(final.withdrawalTaxAccrued ?? 0).toBe(0);
  });

  it('sequential + 22% gross-up rate pulls more from the Trad bucket per month', () => {
    const real = tradOnlyReal({ tradBalance: 1_000_000 });
    const payload = emptyLeverPayload();
    payload.withdrawalStrategy = 'sequential';
    payload.effectiveDrawdownTaxRate = 0.22;
    payload.expensePeriods = [{
      start: '2026-01-01', monthlyDelta: monthlyExpense, durationMonths: 24,
    }];
    payload.returns.defaultRate = 0;
    const states = projectScenario(real, payload, { startISO: '2026-01', months: horizonMonths });
    const final = states[states.length - 1];

    // 12 months of $5k NET draws. Gross = 5000 / (1 - 0.22) = $6,410.26/mo.
    // 12 months gross = $76,923. Trad should be down by ~$76.9k, not $60k.
    expect(totalInvestments(final)).toBeCloseTo(923_077, -3);   // ±$1k
    // Cumulative implied tax across the 12 months ≈ 0.22 * 76923 = $16,923.
    // The state's `withdrawalTaxAccrued` resets per step, so the final state
    // shows only the LAST step's tax. Sum across all steps:
    const totalTaxAccrued = states.reduce((s, st) => s + (st.withdrawalTaxAccrued ?? 0), 0);
    expect(totalTaxAccrued).toBeCloseTo(16923, -2);             // ±$100
  });

  it('30-year delta: gross-up materially reduces ending Trad balance vs no-gross-up', () => {
    // Pre-fix vs post-fix comparison for the headline finance review claim.
    // We use a 30y horizon, 7% returns, 60k flat expenses, and a 22% effective
    // tax rate. The "no gross-up" path is the legacy sequential-with-rate-0;
    // the "with gross-up" path uses 0.22.
    //
    // Note: while the finance reviewer's headline number was "$200-300k", that
    // was a back-of-envelope estimate. Actual compounding magnifies the gap
    // because each year's additional gross withdrawal forgoes 7% growth for
    // the remaining horizon — at 30y the over-statement is in the low millions
    // (under-collected tax × compounded retirement-account growth). The
    // direction is what matters: pre-fix projections systematically
    // OVER-state ending balances for Trad-heavy retirees.
    const buildPayload = (rate: number) => {
      const p = emptyLeverPayload();
      p.withdrawalStrategy = 'sequential';
      p.effectiveDrawdownTaxRate = rate;
      p.expensePeriods = [{
        start: '2026-01-01', monthlyDelta: 5000, durationMonths: 360,
      }];
      p.returns.defaultRate = 0.07;
      return p;
    };

    const real = tradOnlyReal({ tradBalance: 1_000_000 });
    const noGrossUp = projectScenario(real, buildPayload(0), { startISO: '2026-01', months: 361 });
    const withGrossUp = projectScenario(real, buildPayload(0.22), { startISO: '2026-01', months: 361 });

    const finalNoGrossUp = totalInvestments(noGrossUp[noGrossUp.length - 1]);
    const finalWithGrossUp = totalInvestments(withGrossUp[withGrossUp.length - 1]);
    const delta = finalNoGrossUp - finalWithGrossUp;

    // The pre-fix path overstates the ending balance. At 22% effective rate
    // over 30y with 7% compounding, the delta runs to ~$1.5-2M — orders of
    // magnitude bigger than the original $200-300k estimate, confirming this
    // was a critical correctness fix.
    expect(delta).toBeGreaterThan(500_000);
    expect(finalNoGrossUp).toBeGreaterThan(finalWithGrossUp);
  });

  it('proportional strategy ignores the gross-up rate (only sequential is affected)', () => {
    const real = tradOnlyReal({ tradBalance: 1_000_000 });
    const payload = emptyLeverPayload();
    payload.withdrawalStrategy = 'proportional';
    payload.effectiveDrawdownTaxRate = 0.22;
    payload.expensePeriods = [{
      start: '2026-01-01', monthlyDelta: monthlyExpense, durationMonths: 24,
    }];
    payload.returns.defaultRate = 0;
    const states = projectScenario(real, payload, { startISO: '2026-01', months: horizonMonths });
    const final = states[states.length - 1];

    // Proportional ignores the rate — balances drop by $60k, not $76.9k.
    expect(totalInvestments(final)).toBeCloseTo(940_000, -3);
    expect(final.withdrawalTaxAccrued ?? 0).toBe(0);
  });
});
