/**
 * Engine stress test — 50y monthly horizon × 100 holdings.
 *
 * Why this file exists (and is committed, not throwaway):
 *   - Three review waves in a row produced an untracked `*-bench.test.ts`
 *     file that auto-ran and silently disappeared (see
 *     docs/reviews/2026-05-27-testing-wave3.md § N4). The structural fix
 *     is to commit one canonical stress test, gate it behind STRESS=1, and
 *     keep it out of the default `npm test`.
 *   - `npm run test:stress` runs this; CI can opt in via the same script.
 *
 * What it verifies:
 *   1. The engine completes 600 monthly steps with 100 invested accounts
 *      in under 10 seconds wall-clock. (Single number ~ 1–3s on modern
 *      laptop; the headroom catches accidental O(n²) regressions in the
 *      per-step account iteration.)
 *   2. Output is deterministic: two runs with the same inputs produce
 *      bit-identical final-state aggregates.
 *   3. No exceptions across the 50-year horizon (catches index OOB,
 *      bracket lookup failures at advanced ages, etc.).
 *
 * What it does NOT verify (intentionally):
 *   - Per-account balance numerics (the e2e suite covers that with smaller
 *     fixtures and clearer assertions).
 *   - Tax engine correctness (covered in tests/lib/tax-*.test.ts).
 *
 * If this test starts timing out, the regression is probably in the
 * per-step account loop — look at engine.ts:stepMonth and the bucket-
 * allocation paths called from it.
 */

import { describe, it, expect } from 'vitest';
import { projectScenario } from '@/lib/scenarios/engine';
import { emptyLeverPayload } from '@/lib/scenarios/lever-types';
import type { RealState } from '@/lib/scenarios/state-snapshot';
import type { Account, Household, Person } from '@/types/schema';
import { AccountType, FilingStatus } from '@/types/enums';
import { totalInvestments } from '@/lib/scenarios/aggregate-investments';
import type { Bracket } from '@/lib/tax';

const ACCOUNT_COUNT = 100;
const HORIZON_MONTHS = 50 * 12; // 600
// Per-account starting balance. The total ($1M) keeps the projection in a
// realistic dollar range so any "balance saturated to zero" early-exit
// shortcut would be visible in the final-state assertion.
const STARTING_BALANCE_PER_ACCOUNT = 10_000;
const RUNTIME_BUDGET_MS = 10_000;

const federal2026Single: Bracket[] = [
  { min: 0, max: 11600, rate: 0.10 },
  { min: 11600, max: 47150, rate: 0.12 },
  { min: 47150, max: 100525, rate: 0.22 },
  { min: 100525, max: 191950, rate: 0.24 },
  { min: 191950, max: 243725, rate: 0.32 },
  { min: 243725, max: 609350, rate: 0.35 },
  { min: 609350, max: null, rate: 0.37 },
];

// Build 100 accounts: a 60/30/10 mix across brokerage / 401k / IRA so
// each tax bucket has nontrivial population. Account.id matches array
// index + 1; the bucket arrays partition the same id space.
function buildStressFixture(): RealState {
  const accounts: Account[] = [];
  const investmentsByAccount: Record<number, number> = {};

  for (let i = 0; i < ACCOUNT_COUNT; i++) {
    const id = i + 1;
    const type =
      i < 60 ? AccountType.ACCOUNT_BROKERAGE
      : i < 90 ? AccountType.ACCOUNT_401K
      : AccountType.ACCOUNT_TRAD_IRA;
    accounts.push({
      id,
      householdId: 1,
      ownerPersonId: 1,
      beneficiaryDependentId: null,
      name: `Stress Acct ${id}`,
      institution: null,
      type,
      cryptoWalletAddress: null,
      autoFetchEnabled: false,
      excludedFromNetWorth: false,
      allowMargin: false,
      stateOfPlan: null,
      accentColor: null,
      hasEmployerMatch: null,
      employerMatchPct: null,
      employerMatchLimitPct: null,
      allowsMegaBackdoorRollover: null,
      hasHighFees: null,
      apyRate: null,
    } as Account);
    investmentsByAccount[id] = STARTING_BALANCE_PER_ACCOUNT;
  }

  const accountsByBucket = {
    taxAdvantaged: accounts.filter((a) =>
      a.type === AccountType.ACCOUNT_401K
      || a.type === AccountType.ACCOUNT_TRAD_IRA
      || a.type === AccountType.ACCOUNT_ROTH_IRA),
    brokerage: accounts.filter((a) => a.type === AccountType.ACCOUNT_BROKERAGE),
    cash: [] as Account[],
  };

  const household = {
    id: 1,
    filingStatus: FilingStatus.SINGLE,
    state: 'CA',
    city: null,
    monthlyExpenseBaseline: 4500,
    withdrawalRate: 0.04,
    inflationAssumption: 0.025,
    growthScenarios: [],
  } as unknown as Household;

  const persons: Person[] = [
    { id: 1, householdId: 1, name: 'StressPerson', annualSalaryPretax: 120000 } as unknown as Person,
  ];

  return {
    accounts,
    holdings: [],
    loans: [],
    loanPayments: [],
    household,
    persons,
    accountsByBucket,
    initialCash: 25_000,
    initialInvestmentsByAccount: investmentsByAccount,
    cashAccountsWithBalances: [],
    defaults: {
      inflation: 0.025,
      returnRate: 0.07,
      defaultCashApy: null,
      autoInvestSalarySurplus: true,
    },
    startISO: '2026-01',
    taxBrackets: {
      federal: federal2026Single,
      state: [],
      city: null,
      standardDeduction: { federal: 14600, state: 0, city: 0 },
    },
  } as RealState;
}

describe('engine stress — 50y × 100 accounts', () => {
  it(`completes ${HORIZON_MONTHS} steps in under ${RUNTIME_BUDGET_MS}ms`, () => {
    const real = buildStressFixture();
    const payload = emptyLeverPayload();

    const start = performance.now();
    const states = projectScenario(real, payload, {
      startISO: real.startISO,
      months: HORIZON_MONTHS,
    });
    const elapsed = performance.now() - start;

    expect(states).toHaveLength(HORIZON_MONTHS);
    expect(elapsed).toBeLessThan(RUNTIME_BUDGET_MS);
    // Smoke-check the final state is sensible (compounded 7%/yr × 50y
    // should leave a positive aggregate even after expenses).
    const finalInvestments = totalInvestments(states[HORIZON_MONTHS - 1]);
    expect(Number.isFinite(finalInvestments)).toBe(true);
    expect(finalInvestments).toBeGreaterThan(0);
  });

  it('produces deterministic output across runs with the same inputs', () => {
    const real = buildStressFixture();
    const payload = emptyLeverPayload();
    const horizon = { startISO: real.startISO, months: HORIZON_MONTHS };

    const a = projectScenario(real, payload, horizon);
    const b = projectScenario(buildStressFixture(), emptyLeverPayload(), horizon);

    // Spot-check at month 0, mid-horizon, and final — full per-step equality
    // is O(100 × 600) which adds noise to a failure; the 3 anchors catch any
    // path-dependent drift introduced by Map iteration order changes or
    // floating-point accumulator reset bugs.
    const anchors = [0, Math.floor(HORIZON_MONTHS / 2), HORIZON_MONTHS - 1];
    for (const i of anchors) {
      expect(totalInvestments(a[i])).toBe(totalInvestments(b[i]));
      expect(a[i].cash).toBe(b[i].cash);
      expect(a[i].netWorth).toBe(b[i].netWorth);
      expect(a[i].monthISO).toBe(b[i].monthISO);
    }
  });
});
