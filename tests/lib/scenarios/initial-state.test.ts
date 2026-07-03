import { describe, it, expect } from 'vitest';
import { projectScenario } from '@/lib/scenarios/engine';
import { captureRealState } from '@/lib/scenarios/state-snapshot';
import { emptyLeverPayload } from '@/lib/scenarios/lever-types';
import type { Holding, Loan, Household, Person, Account, AccountSnapshot, TaxRule, Property } from '@/types/schema';
import type { Bracket } from '@/lib/tax';
import { totalInvestments } from '@/lib/scenarios/aggregate-investments';

// Helper: total invested across all accounts for assertion clarity.
const sumInvestments = (real: { initialInvestmentsByAccount: Record<number, number> }): number =>
  Object.values(real.initialInvestmentsByAccount).reduce((s, v) => s + v, 0);

const federal2026Single: Bracket[] = [
  { min: 0, max: 11600, rate: 0.10 },
  { min: 11600, max: 47150, rate: 0.12 },
  { min: 47150, max: 100525, rate: 0.22 },
  { min: 100525, max: 191950, rate: 0.24 },
  { min: 191950, max: 243725, rate: 0.32 },
  { min: 243725, max: 609350, rate: 0.35 },
  { min: 609350, max: null, rate: 0.37 },
];

const caSingle: Bracket[] = [
  { min: 0, max: 10412, rate: 0.01 },
  { min: 10412, max: 24684, rate: 0.02 },
];

const baseTaxRules: TaxRule[] = [
  { id: 1, taxYear: 2026, jurisdictionType: 'FEDERAL', jurisdictionCode: 'US', filingStatus: 'SINGLE', standardDeduction: 14600, brackets: federal2026Single } as unknown as TaxRule,
  { id: 2, taxYear: 2026, jurisdictionType: 'STATE',   jurisdictionCode: 'CA', filingStatus: 'SINGLE', standardDeduction: 0,     brackets: caSingle } as unknown as TaxRule,
];

const household = {
  id: 1, filingStatus: 'SINGLE', state: 'CA', city: null,
  monthlyExpenseBaseline: 4500, withdrawalRate: 0.04,
  inflationAssumption: 0.025, growthScenarios: [],
} as unknown as Household;

const persons: Person[] = [
  { id: 1, householdId: 1, name: 'P1', annualSalaryPretax: 135000 } as unknown as Person,
];

const brokerage: Account = {
  id: 1, householdId: 1, ownerPersonId: 1, beneficiaryDependentId: null,
  name: 'Brokerage', institution: 'Fidelity', type: 'ACCOUNT_BROKERAGE',
  cryptoWalletAddress: null, autoFetchEnabled: false, excludedFromNetWorth: false,
  allowMargin: false, stateOfPlan: null, accentColor: null,
  hasEmployerMatch: null, employerMatchPct: null, employerMatchLimitPct: null,
  allowsMegaBackdoorRollover: null, hasHighFees: null,
} as unknown as Account;

const checking: Account = {
  ...brokerage,
  id: 2, name: 'Checking', type: 'ACCOUNT_CASH',
} as unknown as Account;

const savings: Account = {
  ...brokerage,
  id: 3, name: 'Savings', type: 'ACCOUNT_SAVINGS',
} as unknown as Account;

const excludedAccount: Account = {
  ...brokerage,
  id: 4, name: 'Joint pool', type: 'ACCOUNT_BROKERAGE', excludedFromNetWorth: true,
} as unknown as Account;

function makeSnap(accountId: number, totalValue: number, date = '2026-05-01'): AccountSnapshot {
  return { id: accountId, accountId, snapshotDate: date, totalValue, source: 'MANUAL' } as unknown as AccountSnapshot;
}

const loans: Loan[] = [];

describe('captureRealState — initial cash and investments', () => {
  it('seeds initialInvestments from latest non-cash account snapshots', () => {
    // 50K brokerage + 30K 401K-equivalent (brokerage type) = $80K invested.
    const real = captureRealState({
      accounts: [brokerage, { ...brokerage, id: 5, name: '401K' } as Account],
      accountSnapshots: [
        makeSnap(1, 50000),
        makeSnap(5, 30000),
      ],
      holdings: [],
      loans, loanPayments: [], transactions: [],
      household, persons,
      appSettings: { defaultInflation: 0.025, defaultReturnRate: 0.07 },
      startISO: '2026-05',
      taxRules: baseTaxRules,
    });

    expect(sumInvestments(real)).toBe(80000);
    expect(real.initialCash).toBe(0);
  });

  it('seeds initialCash from CASH and SAVINGS account snapshots', () => {
    const real = captureRealState({
      accounts: [checking, savings],
      accountSnapshots: [
        makeSnap(2, 5000),
        makeSnap(3, 25000),
      ],
      holdings: [],
      loans, loanPayments: [], transactions: [],
      household, persons,
      appSettings: { defaultInflation: 0.025, defaultReturnRate: 0.07 },
      startISO: '2026-05',
      taxRules: baseTaxRules,
    });

    expect(real.initialCash).toBe(30000);
    expect(sumInvestments(real)).toBe(0);
  });

  it('skips accounts marked excludedFromNetWorth', () => {
    const real = captureRealState({
      accounts: [brokerage, excludedAccount],
      accountSnapshots: [
        makeSnap(1, 50000),
        makeSnap(4, 100000), // excluded
      ],
      holdings: [],
      loans, loanPayments: [], transactions: [],
      household, persons,
      appSettings: { defaultInflation: 0.025, defaultReturnRate: 0.07 },
      startISO: '2026-05',
      taxRules: baseTaxRules,
    });

    expect(sumInvestments(real)).toBe(50000);
  });

  it('uses latest snapshot when an account has multiple', () => {
    const real = captureRealState({
      accounts: [brokerage],
      accountSnapshots: [
        makeSnap(1, 40000, '2026-02-01'),
        makeSnap(1, 50000, '2026-04-01'),
        makeSnap(1, 45000, '2026-03-01'),
      ],
      holdings: [],
      loans, loanPayments: [], transactions: [],
      household, persons,
      appSettings: { defaultInflation: 0.025, defaultReturnRate: 0.07 },
      startISO: '2026-05',
      taxRules: baseTaxRules,
    });

    expect(sumInvestments(real)).toBe(50000);
  });

  it('ignores snapshots dated after startISO month', () => {
    const real = captureRealState({
      accounts: [brokerage],
      accountSnapshots: [
        makeSnap(1, 50000, '2026-03-01'),
        makeSnap(1, 80000, '2026-07-01'), // future
      ],
      holdings: [],
      loans, loanPayments: [], transactions: [],
      household, persons,
      appSettings: { defaultInflation: 0.025, defaultReturnRate: 0.07 },
      startISO: '2026-05',
      taxRules: baseTaxRules,
    });

    // March snapshot wins; July ignored.
    expect(sumInvestments(real)).toBe(50000);
  });

  it('falls back to holdings (shareCount * costBasis) when an investment account has no snapshot', () => {
    // Backwards-compat for the narrow case where the user entered per-line holdings
    // but never recorded a snapshot total.
    const holdings: Holding[] = [
      { id: 1, accountId: 1, ticker: 'VTI', shareCount: 100, costBasis: 200, targetAllocationPct: null } as unknown as Holding,
    ];
    const real = captureRealState({
      accounts: [brokerage],
      accountSnapshots: [],
      holdings,
      loans, loanPayments: [], transactions: [],
      household, persons,
      appSettings: { defaultInflation: 0.025, defaultReturnRate: 0.07 },
      startISO: '2026-05',
      taxRules: baseTaxRules,
    });

    expect(sumInvestments(real)).toBe(20000);
  });
});

describe('projectScenario — initial-state regression for negative-growth chart bug', () => {
  it('FIXED: empty holdings + snapshot-tracked brokerage seeds initial investments correctly', () => {
    // The original bug: this combination produced investments=0 at t=0, then went negative.
    const real = captureRealState({
      accounts: [brokerage, checking],
      accountSnapshots: [
        makeSnap(1, 50000),
        makeSnap(2, 5000),
      ],
      holdings: [],
      loans, loanPayments: [], transactions: [],
      household, persons,
      appSettings: { defaultInflation: 0.025, defaultReturnRate: 0.07 },
      startISO: '2026-05',
      taxRules: baseTaxRules,
    });

    const states = projectScenario(real, emptyLeverPayload(), { startISO: '2026-05', months: 24 });
    expect(totalInvestments(states[0])).toBe(50000);
    expect(states[0].cash).toBe(5000);
  });

  it('FIXED: realistic household ($135K salary, $4.5k/mo expenses, $50K brokerage, $5K cash) shows positive growth over 30 years', () => {
    // The live-app smoke scenario the user is debugging.
    const real = captureRealState({
      accounts: [brokerage, checking],
      accountSnapshots: [
        makeSnap(1, 50000),
        makeSnap(2, 5000),
      ],
      holdings: [],
      loans, loanPayments: [], transactions: [],
      household, persons,
      appSettings: { defaultInflation: 0.025, defaultReturnRate: 0.07 },
      startISO: '2026-05',
      taxRules: baseTaxRules,
    });

    const states = projectScenario(real, emptyLeverPayload(), { startISO: '2026-05', months: 360 });

    // t=0 NW > 0 (no loans, $55K assets).
    expect(states[0].netWorth).toBeGreaterThan(50000);
    // 5 years: must have grown.
    expect(states[60].netWorth).toBeGreaterThan(states[0].netWorth);
    // 30 years: must have grown substantially.
    expect(states[359].netWorth).toBeGreaterThan(states[60].netWorth);
    // Investments must never go negative in this scenario.
    for (let i = 0; i < states.length; i++) {
      expect(totalInvestments(states[i])).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('projectScenario — physical assets seed net worth once, flat, loans amortize (Wave 2 §5)', () => {
  it('t=0 NW = investments + home − mortgage (counted once); equity grows only via paydown', () => {
    const mortgage: Loan = {
      id: 9, householdId: 1, obligorPersonId: null, name: 'Mortgage', type: 'MORTGAGE',
      originalAmount: 400_000, currentBalance: 350_000, interestRate: 0.04,
      termMonths: 360, firstPaymentDate: '2024-01-01', monthlyPayment: 1_909.66,
      extraPaymentDefault: 0, linkedPropertyId: 7, linkedVehicleId: null,
    } as unknown as Loan;
    const home = {
      id: 7, householdId: 1, ownerPersonId: null, name: 'Home', type: 'PRIMARY_RESIDENCE',
      address: null, purchaseDate: null, purchasePrice: null,
      currentEstimatedValue: 400_000, linkedLoanId: 9, excludedFromNetWorth: false,
    } as unknown as Property;

    const real = captureRealState({
      accounts: [brokerage],
      accountSnapshots: [makeSnap(1, 50_000)],
      holdings: [], loans: [mortgage], loanPayments: [], transactions: [],
      household, persons,
      appSettings: { defaultInflation: 0.025, defaultReturnRate: 0.07 },
      startISO: '2026-05', taxRules: baseTaxRules,
      properties: [home], vehicles: [], assetValueSnapshots: [],
    });
    const states = projectScenario(real, emptyLeverPayload(), { startISO: '2026-05', months: 13 });

    // 50k investments + 400k home − 350k mortgage. The old engine said 50k − 350k.
    // Gross seed + full debt subtraction ⇒ the mortgage is counted exactly once.
    expect(states[0].netWorth).toBeCloseTo(100_000, 0);
    expect(states[0].homeEquity).toBe(400_000);
    // Held flat — no appreciation modeling (disclosed in the What-If footnote).
    expect(states[12].homeEquity).toBe(400_000);
    // The loan side amortizes, so NW rises via paydown independent of savings.
    const debtAt = (i: number) => Object.values(states[i].debtByLoan).reduce((a, b) => a + b, 0);
    expect(debtAt(12)).toBeLessThan(debtAt(0));
  });
});
