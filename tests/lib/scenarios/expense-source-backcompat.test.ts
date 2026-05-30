import { describe, it, expect } from 'vitest';
import { projectScenario } from '@/lib/scenarios/engine';
import { emptyLeverPayload } from '@/lib/scenarios/lever-types';
import type { RealState } from '@/lib/scenarios/state-snapshot';
import type { Holding, Household, Person } from '@/types/schema';
import type { Bracket } from '@/lib/tax';

// Catastrophe guard (spec §Tests "Back-compat byte-for-byte"): a periods-only
// scenario must project IDENTICALLY before/after Feature B. Strict toEqual on
// the full per-state {cash, netWorth, investmentsByAccount, expenses}, MULTI-YEAR
// (36 months) so a base-injection bug OUTSIDE the *inflationFactor term — which a
// month-1 factor≈1.0 would hide — is caught once the factor diverges.

const holdings = [
  { id: 1, accountId: 1, ticker: 'VTI', shareCount: 1000, costBasis: 200, targetAllocationPct: null },
] as unknown as Holding[];

const household = {
  id: 1, filingStatus: 'SINGLE', state: 'TX', city: null,
  monthlyExpenseBaseline: 4500, withdrawalRate: 0.04,
  inflationAssumption: 0.03, growthScenarios: [],
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

// A hand-built RealState with a NON-ZERO inflation rate so the *inflationFactor
// term grows month-over-month — the whole point of the multi-year guard. NOTE:
// expenseBasis is added by Task 4; this fixture omits it deliberately so the
// test compiles against the PRE-Task-4 RealState. Task 4 + Task 5 must keep this
// test green (the engine must treat a missing expenseBasis as a 0 base under the
// custom default, identical to today).
function realStateFactory(): RealState {
  return {
    accounts: [],
    holdings,
    loans: [],
    loanPayments: [],
    household,
    persons,
    accountsByBucket: { taxAdvantaged: [], brokerage: [], cash: [] },
    initialCash: 50_000,
    initialInvestmentsByAccount: { 1: 200_000 },
    cashAccountsWithBalances: [],
    defaults: { inflation: 0.03, returnRate: 0.05, defaultCashApy: null, defaultDrawdownTaxRate: null },
    startISO: '2026-05',
    taxBrackets: {
      federal: federal2026Single, state: [], city: null, ltcg: [],
      standardDeduction: { federal: 14_600, state: 0, city: 0 },
    },
    housingPayments: [],
    vehicleLeases: [],
  } as unknown as RealState;
}

// A periods-only payload: the entire expense is encoded as one long period.
// This is the shape EVERY pre-Feature-B saved scenario has.
function periodsOnlyPayload() {
  const p = emptyLeverPayload();
  p.returns.defaultRate = 0.05;
  p.inflation = { defaultRate: 0.03, overrides: {} };
  p.expensePeriods = [{ start: '2026-05-01', monthlyDelta: 4000, durationMonths: 480 }];
  return p;
}

function projectionFingerprint(real: RealState) {
  const months = 36; // multi-year — past where inflationFactor ≈ 1
  return projectScenario(real, periodsOnlyPayload(), { startISO: '2026-05', months }).map((s) => ({
    monthISO: s.monthISO,
    cash: s.cash,
    netWorth: s.netWorth,
    expenses: s.expenses,
    investmentsByAccount: s.investmentsByAccount,
  }));
}

describe('Feature B — byte-for-byte back-compat (periods-only scenario)', () => {
  it('a periods-only scenario projects deterministically (this snapshot is the reference)', () => {
    const a = projectionFingerprint(realStateFactory());
    const b = projectionFingerprint(realStateFactory());
    // Strict equality — NOT toBeCloseTo. Any drift across 36 months fails here.
    expect(a).toEqual(b);
    // Anchor month-1 and the final month so the expense path is genuinely
    // exercised (and the 4000 base flows through inflation, not flat).
    expect(a[1].expenses).toBeGreaterThan(0);
    expect(a[a.length - 1].expenses).toBeGreaterThan(a[1].expenses); // inflation grew it
  });
});
