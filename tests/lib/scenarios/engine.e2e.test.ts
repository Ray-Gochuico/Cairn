import { describe, it, expect } from 'vitest';
import { projectScenario } from '@/lib/scenarios/engine';
import { emptyLeverPayload } from '@/lib/scenarios/lever-types';
import type { RealState } from '@/lib/scenarios/state-snapshot';
import type { Account, Holding, Loan, Household, Person } from '@/types/schema';
import { AccountType } from '@/types/enums';
import type { Bracket } from '@/lib/tax';
import { totalInvestments } from '@/lib/scenarios/aggregate-investments';

const holdings = [
  { id: 1, accountId: 1, ticker: 'VTI', shareCount: 1000, costBasis: 200, targetAllocationPct: null },
] as unknown as Holding[];

const loans = [
  { id: 1, householdId: 1, name: 'Auto', type: 'AUTO', currentBalance: 18400, interestRate: 0.059, monthlyPayment: 425, termMonths: 60 },
] as unknown as Loan[];

const household = {
  id: 1,
  filingStatus: 'SINGLE',
  state: 'CA',
  city: null,
  monthlyExpenseBaseline: 4500,
  withdrawalRate: 0.04,
  inflationAssumption: 0.025,
  growthScenarios: [],
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

const caSingle: Bracket[] = [
  { min: 0, max: 10412, rate: 0.01 },
  { min: 10412, max: 24684, rate: 0.02 },
  { min: 24684, max: 38959, rate: 0.04 },
  { min: 38959, max: 54081, rate: 0.06 },
  { min: 54081, max: 68350, rate: 0.08 },
  { min: 68350, max: 349137, rate: 0.093 },
  { min: 349137, max: null, rate: 0.103 },
];

const realState: RealState = {
  accounts: [],
  holdings,
  loans,
  loanPayments: [],
  household,
  persons,
  accountsByBucket: { taxAdvantaged: [], brokerage: [], cash: [] },
  initialCash: 0,
  initialInvestmentsByAccount: { 1: 200000 }, // 1000 shares VTI @ $200 costBasis
  cashAccountsWithBalances: [],
  // Migration 0029 — these e2e fixtures predate the OFF default and pin
  // auto-invest behavior on the savings → investments path. Opt back in here
  // so the "saving household: investments rise" / "parity: cash stays at 0"
  // assertions keep their original intent.
  defaults: {
    inflation: 0.025,
    returnRate: 0.07,
    defaultCashApy: null,
    autoInvestSalarySurplus: true,
  },
  startISO: '2026-05',
  taxBrackets: {
    federal: federal2026Single,
    state: caSingle,
    city: null,
    standardDeduction: 14600,
  },
};

/** Builds a long-duration $amount/mo expense period to replace the legacy
 * `realState.baselineMonthlyExpenses` field (2026-05-26 revamp). */
function e2eExpensePeriods(monthlyAmount: number) {
  return [{ start: '2026-05-01', monthlyDelta: monthlyAmount, durationMonths: 480 }];
}

describe('projectScenario (end-to-end)', () => {
  it('produces one MonthlyState per month for the requested horizon', () => {
    const states = projectScenario(realState, emptyLeverPayload(), { startISO: '2026-05', months: 60 });
    expect(states).toHaveLength(60);
    expect(states[0].monthISO).toBe('2026-05');
    expect(states[59].monthISO).toBe('2031-04');
  });

  it('investments compound under the default 7% return when no overrides are set', () => {
    const states = projectScenario(realState, emptyLeverPayload(), { startISO: '2026-05', months: 13 });
    const inv0 = totalInvestments(states[0]);
    const inv12 = totalInvestments(states[12]);
    expect(inv12).toBeGreaterThan(inv0);
  });

  it('debt-free milestone fires when extra payments accelerate the auto loan', () => {
    const payload = emptyLeverPayload();
    payload.extraLoanPayments = [{ loanId: 1, extraMonthly: 300 }];
    const states = projectScenario(realState, payload, { startISO: '2026-05', months: 60 });
    const debtFreeMonth = states.find((s) => Object.values(s.debtByLoan).reduce((a, b) => a + b, 0) === 0);
    expect(debtFreeMonth).toBeDefined();
    // Compare against no-extra trajectory: must hit zero earlier
    const baseline = projectScenario(realState, emptyLeverPayload(), { startISO: '2026-05', months: 60 });
    const baselineDebtFree = baseline.find((s) => Object.values(s.debtByLoan).reduce((a, b) => a + b, 0) === 0);
    expect(debtFreeMonth!.monthISO < (baselineDebtFree?.monthISO ?? '9999-99')).toBe(true);
  });
});

describe('projectScenario — contributions lever combined with other levers', () => {
  it('handles contributions + extra loan payments + return overrides together without crashing or breaking earlier invariants', () => {
    const payload = emptyLeverPayload();
    payload.contributions = [
      { startMonth: 0, endMonth: 59, monthlyAmount: 1000, label: 'Y1-Y5 $1k/mo' },
      { startMonth: 60, endMonth: null, monthlyAmount: 2000, label: 'Y6+ $2k/mo' },
    ];
    payload.extraLoanPayments = [{ loanId: 1, extraMonthly: 200 }];
    payload.returns = { defaultRate: 0.07, overrides: { '2027': -0.15, '2028': 0.2 }, cashRate: null };

    const states = projectScenario(realState, payload, { startISO: '2026-05', months: 84 });

    // Auto loan still gets paid off (extra payments win — milestone still fires).
    const debtFreeMonth = states.find((s) => Object.values(s.debtByLoan).reduce((a, b) => a + b, 0) === 0);
    expect(debtFreeMonth).toBeDefined();

    // Spot-check: month 60 lies in the Y6+ segment ($2000/mo) and prior months
    // in the Y1-Y5 segment ($1000/mo). Net worth must be a finite number through
    // the horizon — the combination of negative-year returns, extra debt service,
    // and contribution routing must not produce NaN or Infinity.
    expect(Number.isFinite(states[60].netWorth)).toBe(true);
    expect(Number.isFinite(totalInvestments(states[83]))).toBe(true);
  });

  it('shortfall is permitted: cash floors at zero and investments absorb the deficit', () => {
    // Adjusted for the cash-floor change: cash bottoms at 0 and any remaining
    // deficit (after contributions and the savings shortfall) hits investments.
    const hostileReal: RealState = {
      ...realState,
      household: { ...realState.household, monthlyExpenseBaseline: 99999 } as Household,
    };
    const payload = emptyLeverPayload();
    payload.expensePeriods = e2eExpensePeriods(99999);
    payload.contributions = [{ startMonth: 0, endMonth: 11, monthlyAmount: 1500 }];
    const states = projectScenario(hostileReal, payload, { startISO: '2026-05', months: 13 });
    expect(states[11].cash).toBe(0);
    // Run never produces NaN/Infinity even when the household is insolvent.
    expect(Number.isFinite(totalInvestments(states[11]))).toBe(true);
  });
});

describe('projectScenario — cash floor + investments deficit routing', () => {
  // No-loans, no-return base so each test reads the routing exactly.
  // (RealState.defaults are read by ChartToolbar etc; the engine reads
  // payload.returns. Tests below set both.)
  const flatReal: RealState = {
    ...realState,
    loans: [],
    defaults: {
      inflation: 0,
      returnRate: 0,
      defaultCashApy: null,
      autoInvestSalarySurplus: true,
    },
  };

  function zeroReturnPayload() {
    const p = emptyLeverPayload();
    p.returns = { defaultRate: 0, overrides: {}, cashRate: null };
    return p;
  }

  it('saving household: investments rise from both savings and returns', () => {
    // Positive-savings household: cash gets no flow (savings > 0 → routed
    // to investments). With nonzero return investments grow from BOTH the
    // savings contribution and compounded return each month.
    const real: RealState = {
      ...flatReal,
      household: { ...flatReal.household, monthlyExpenseBaseline: 3000 } as Household,
    };
    const sevenPct = emptyLeverPayload(); // defaultRate: 0.07
    sevenPct.expensePeriods = e2eExpensePeriods(3000);
    const states = projectScenario(real, sevenPct, { startISO: '2026-05', months: 13 });
    expect(totalInvestments(states[12])).toBeGreaterThan(totalInvestments(states[0]));
    expect(states[12].cash).toBeGreaterThanOrEqual(0);
    // Compare with-return vs no-return trajectory. The 7% one must end
    // higher than the 0% one, confirming returns are applied AFTER the
    // savings routing.
    const zeroReturnSaving = zeroReturnPayload();
    zeroReturnSaving.expensePeriods = e2eExpensePeriods(3000);
    const noReturnStates = projectScenario(real, zeroReturnSaving, { startISO: '2026-05', months: 13 });
    expect(totalInvestments(states[12])).toBeGreaterThan(totalInvestments(noReturnStates[12]));
  });

  it('moderate deficit with cash buffer: cash drawn down (not negative)', () => {
    // Seed a positive-cash situation by configuring a contributions segment
    // that pulls slightly less than savings into investments — surplus flows
    // to cash. Verify that cash builds up without going negative.
    const payload = zeroReturnPayload();
    payload.contributions = [{ startMonth: 0, endMonth: 5, monthlyAmount: 100 }];
    const states = projectScenario(flatReal, payload, { startISO: '2026-05', months: 7 });
    expect(states[6].cash).toBeGreaterThan(0);
    expect(totalInvestments(states[6])).toBeGreaterThan(totalInvestments(states[0]));
  });

  it('heavy deficit: cash floors at zero, investments draws down, returns still applied each month', () => {
    // Deficit household: expenses just exceed income so savings is negative
    // each month, but the monthly draw is small enough that investments
    // stay positive across the 12-month horizon. Compare 5%-return vs
    // 0%-return: with positive return the investments balance erodes less
    // per month, ending HIGHER than the no-return case. This is the
    // observable signal that returns are applied AFTER the cash-floor
    // deduction each month (step 7 in stepMonth).
    // Income at 135k/yr CA → ~$8k/mo after-tax → mild deficit at $9k/mo
    // expenses + $425 loan → ~$1.4k/mo deficit on $200k investments.
    const real: RealState = {
      ...flatReal,
      household: { ...flatReal.household, monthlyExpenseBaseline: 9000 } as Household,
      loans: [], // already cleared in flatReal, kept explicit
    };
    const fivePct = emptyLeverPayload();
    fivePct.expensePeriods = e2eExpensePeriods(9000);
    fivePct.returns = { defaultRate: 0.05, overrides: {}, cashRate: null };
    const states = projectScenario(real, fivePct, { startISO: '2026-05', months: 13 });
    // Cash never dips below zero.
    for (let i = 0; i < states.length; i++) {
      expect(states[i].cash).toBeGreaterThanOrEqual(0);
    }
    // Investments stay positive across the horizon and absorb the deficit.
    expect(totalInvestments(states[12])).toBeGreaterThan(0);
    expect(totalInvestments(states[12])).toBeLessThan(totalInvestments(states[0]));
    // Returns are still applied each month: 5%-return ends higher than 0%.
    const noReturnHostile = zeroReturnPayload();
    noReturnHostile.expensePeriods = e2eExpensePeriods(9000);
    const noReturnStates = projectScenario(real, noReturnHostile, { startISO: '2026-05', months: 13 });
    expect(totalInvestments(states[12])).toBeGreaterThan(totalInvestments(noReturnStates[12]));
  });

  it('parity: saving household without contributions, 100% brokerage gap allocation routes surplus to investments', () => {
    // Saving household → savings > 0 path. Configure a 100% brokerage gap
    // allocation so the surplus routes to investments (mirroring the
    // pre-revamp auto-invest path). Cash stays at zero; the monthly
    // investment delta is constant under 0% return + 0% inflation.
    const investingReal: RealState = {
      ...flatReal,
      accountsByBucket: {
        taxAdvantaged: [],
        brokerage: [{ id: 1, householdId: 1, name: 'Brk', type: 'ACCOUNT_BROKERAGE', excludedFromNetWorth: false } as never],
        cash: [],
      },
    };
    const payload = zeroReturnPayload();
    payload.gapAllocation = {
      taxAdvantaged: null,
      brokerage: { mode: 'percent', value: 1.0, accountSplits: null },
    };
    const states = projectScenario(investingReal, payload, { startISO: '2026-05', months: 13 });
    expect(states[12].cash).toBe(0);
    expect(totalInvestments(states[12])).toBeGreaterThan(totalInvestments(states[0]));
    const delta1 = totalInvestments(states[1]) - totalInvestments(states[0]);
    const delta12 = totalInvestments(states[12]) - totalInvestments(states[11]);
    expect(delta1).toBeCloseTo(delta12, 5);
  });
});

describe('projectScenario — tax behavior', () => {
  it('after-tax income rises year-over-year as raises lift gross income', () => {
    const realCA: RealState = { ...realState, household: { ...realState.household, state: 'CA' } as Household };
    const payload = emptyLeverPayload();
    payload.income.perPerson[0].annualRaiseRate = 0.03;
    const states = projectScenario(realCA, payload, { startISO: '2026-05', months: 36 });
    // Sample after-tax income across years: should monotonically rise with a 3% explicit raise plan.
    const month0  = states[0].incomeAfterTax;
    const month12 = states[12].incomeAfterTax;
    const month24 = states[24].incomeAfterTax;
    expect(month12).toBeGreaterThan(month0);
    expect(month24).toBeGreaterThan(month12);
  });

  it('CA household pays more tax than TX household at the same gross income', () => {
    const realCA: RealState = {
      ...realState,
      household: { ...realState.household, state: 'CA' } as Household,
      taxBrackets: { federal: federal2026Single, state: caSingle, city: null, standardDeduction: 14600 },
    };
    const realTX: RealState = {
      ...realState,
      household: { ...realState.household, state: 'TX' } as Household,
      taxBrackets: { federal: federal2026Single, state: [], city: null, standardDeduction: 14600 },
    };
    const caAfter12 = projectScenario(realCA, emptyLeverPayload(), { startISO: '2026-05', months: 13 });
    const txAfter12 = projectScenario(realTX, emptyLeverPayload(), { startISO: '2026-05', months: 13 });
    // CA pays state tax; TX does not → CA's after-tax monthly income must be lower
    expect(caAfter12[12].incomeAfterTax).toBeLessThan(txAfter12[12].incomeAfterTax);
  });
});

describe('projectScenario — contribution allocation routing', () => {
  // Two-account fixture (10 = "Acct A" 60k, 11 = "Acct B" 40k).
  // The household keeps its $135k salary and a low expense baseline so monthly
  // savings stays well above any contribution we test below; that keeps the
  // contribution routing the only signal moving per-account balances. 0% return
  // + 0% inflation keeps the math exact.
  const twoAccountReal: RealState = {
    ...realState,
    initialInvestmentsByAccount: { 10: 60_000, 11: 40_000 },
    initialCash: 50_000, // ample buffer; contribution remainders flow here
    defaults: {
      inflation: 0,
      returnRate: 0,
      defaultCashApy: null,
      autoInvestSalarySurplus: true,
    },
    loans: [], // strip the auto loan so the only signal is the contribution
  };

  function zeroReturnPayload() {
    const p = emptyLeverPayload();
    p.returns = { defaultRate: 0, overrides: {}, cashRate: null };
    // Match the pre-revamp factory's $2000/mo expense baseline.
    p.expensePeriods = e2eExpensePeriods(2000);
    return p;
  }

  it('distributes contributions evenly when no allocation is set', () => {
    const payload = {
      ...zeroReturnPayload(),
      contributions: [{ startMonth: 0, endMonth: 11, monthlyAmount: 2000, allocation: null }],
    };
    const states = projectScenario(twoAccountReal, payload, { startISO: '2026-05', months: 2 });
    // Month 1 applies the first contribution. Even split across 2 accounts → +1000 each.
    expect(states[1].investmentsByAccount[10]).toBeCloseTo(60_000 + 1000, 5);
    expect(states[1].investmentsByAccount[11]).toBeCloseTo(40_000 + 1000, 5);
  });

  it('routes contributions according to explicit allocation map', () => {
    const payload = {
      ...zeroReturnPayload(),
      contributions: [{
        startMonth: 0,
        endMonth: 11,
        monthlyAmount: 1000,
        allocation: { '10': 0.8, '11': 0.2 },
      }],
    };
    const states = projectScenario(twoAccountReal, payload, { startISO: '2026-05', months: 2 });
    expect(states[1].investmentsByAccount[10]).toBeCloseTo(60_000 + 800, 5);
    expect(states[1].investmentsByAccount[11]).toBeCloseTo(40_000 + 200, 5);
  });

  it('drops stale allocation IDs and renormalizes remaining proportions', () => {
    // Account 99 is stale (not in initialInvestmentsByAccount). 50/50 over IDs
    // 10 and 11 — proportion on 99 is dropped and the remaining map is already
    // normalized so the engine must still divide $1000 evenly.
    const payload = {
      ...zeroReturnPayload(),
      contributions: [{
        startMonth: 0,
        endMonth: 11,
        monthlyAmount: 1000,
        allocation: { '10': 0.5, '11': 0.5, '99': 0.0 },
      }],
    };
    const states = projectScenario(twoAccountReal, payload, { startISO: '2026-05', months: 2 });
    expect(states[1].investmentsByAccount[10]).toBeCloseTo(60_000 + 500, 5);
    expect(states[1].investmentsByAccount[11]).toBeCloseTo(40_000 + 500, 5);
    // Stale ID never gets added.
    expect(states[1].investmentsByAccount[99]).toBeUndefined();
  });

  it('drawdown from investments is proportional to current per-account balances', () => {
    // Hostile household: zero income (persons=[]), zero cash, high expenses,
    // zero return. Each month produces a deficit that hits investments after
    // cash floors at zero. With initial 60/40 split, the proportional draw
    // should keep the ratio roughly intact: account 10 (60%) loses more in
    // absolute terms.
    const shortfallReal: RealState = {
      ...twoAccountReal,
      persons: [],
      initialCash: 0,
    };
    const shortfallPayload = zeroReturnPayload();
    shortfallPayload.expensePeriods = e2eExpensePeriods(5000);
    const states = projectScenario(shortfallReal, shortfallPayload, { startISO: '2026-05', months: 2 });
    const drop10 = states[0].investmentsByAccount[10]! - states[1].investmentsByAccount[10]!;
    const drop11 = states[0].investmentsByAccount[11]! - states[1].investmentsByAccount[11]!;
    expect(drop10).toBeGreaterThan(drop11);
    // The ratio of drops should match the ratio of starting balances (60/40 = 1.5).
    expect(drop10 / drop11).toBeCloseTo(60 / 40, 2);
  });
});

describe('projectScenario — cash APY growth', () => {
  // Base fixture: no investments, no loans, no income, no expenses.
  // Cash at $10,000. We want to verify ONLY the cash compounding math.
  const cashOnlyReal: RealState = {
    ...realState,
    persons: [],
    loans: [],
    initialCash: 10_000,
    initialInvestmentsByAccount: {},
    cashAccountsWithBalances: [], // overridden per-test with APY
    defaults: {
      inflation: 0,
      returnRate: 0,
      defaultCashApy: null,
      autoInvestSalarySurplus: true,
    },
  };

  it('cash grows at ~5% APY over 12 months ($10k → ~$10,512)', () => {
    // 5% APY → monthly rate = (1.05)^(1/12) - 1 ≈ 0.004074
    // After 12 months: $10,000 * (1.05)^(12/12) = $10,500
    // (small deviation because of discrete monthly compounding vs annual)
    const fivePercentApy: RealState = {
      ...cashOnlyReal,
      cashAccountsWithBalances: [
        {
          account: {
            id: 99,
            householdId: 1,
            ownerPersonId: null,
            beneficiaryDependentId: null,
            name: 'HYSA',
            institution: null,
            type: AccountType.ACCOUNT_SAVINGS,
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
            apyRate: 0.05,
          } as unknown as Account,
          balance: 10_000,
        },
      ],
    };

    const payload = emptyLeverPayload();
    payload.returns = { defaultRate: 0, overrides: {}, cashRate: null };

    const states = projectScenario(fivePercentApy, payload, { startISO: '2026-05', months: 13 });
    // Month 0 = $10,000 (start); month 12 = after 12 monthly growth steps.
    expect(states[0].cash).toBeCloseTo(10_000, 2);
    // 5% annual → after 12 months ≈ $10,500 (continuous would be $10,512 — discrete monthly is $10,500 exactly).
    expect(states[12].cash).toBeGreaterThan(10_400);
    expect(states[12].cash).toBeLessThan(10_600);
  });

  it('cash stays flat when no APY is set (APY resolves to 0)', () => {
    const payload = emptyLeverPayload();
    payload.returns = { defaultRate: 0, overrides: {}, cashRate: null };

    const states = projectScenario(cashOnlyReal, payload, { startISO: '2026-05', months: 13 });
    expect(states[12].cash).toBeCloseTo(10_000, 2);
  });

  it('scenario cashRate override takes priority over account APY', () => {
    const withAccountApy: RealState = {
      ...cashOnlyReal,
      cashAccountsWithBalances: [
        {
          account: {
            id: 99,
            householdId: 1,
            ownerPersonId: null,
            beneficiaryDependentId: null,
            name: 'HYSA',
            institution: null,
            type: AccountType.ACCOUNT_SAVINGS,
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
            apyRate: 0.10,
          } as unknown as Account,
          balance: 10_000,
        },
      ],
    };

    const payload = emptyLeverPayload();
    payload.returns = { defaultRate: 0, overrides: {}, cashRate: 0.04 }; // scenario override: 4%

    const states = projectScenario(withAccountApy, payload, { startISO: '2026-05', months: 13 });
    // With 4% APY (scenario override), after 12 months: ~10,400
    // With 10% APY (account), after 12 months: ~11,047
    // Override means result must be below 11,000 (not using 10% account APY)
    expect(states[12].cash).toBeLessThan(10_600);
    expect(states[12].cash).toBeGreaterThan(10_300);
  });

  it('cash growth uses the frozen rate (APY computed once at start)', () => {
    // The engine freezes effectiveCashApy_frozen at projection start.
    // This is a structural test: two runs with different cashAccountsWithBalances
    // but same initialCash must produce different results (the apy is read).
    const noApyReal: RealState = { ...cashOnlyReal, cashAccountsWithBalances: [] };
    const withApyReal: RealState = {
      ...cashOnlyReal,
      cashAccountsWithBalances: [
        {
          account: { id: 99, type: AccountType.ACCOUNT_SAVINGS, apyRate: 0.05 } as unknown as Account,
          balance: 10_000,
        },
      ],
    };
    const payload = emptyLeverPayload();
    payload.returns = { defaultRate: 0, overrides: {}, cashRate: null };

    const noApyStates = projectScenario(noApyReal, payload, { startISO: '2026-05', months: 13 });
    const withApyStates = projectScenario(withApyReal, payload, { startISO: '2026-05', months: 13 });

    expect(withApyStates[12].cash).toBeGreaterThan(noApyStates[12].cash);
  });
});
