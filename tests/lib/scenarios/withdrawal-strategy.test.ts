import { describe, it, expect } from 'vitest';
import { projectScenario } from '@/lib/scenarios/engine';
import { emptyLeverPayload } from '@/lib/scenarios/lever-types';
import type { RealState } from '@/lib/scenarios/state-snapshot';
import type { Account } from '@/types/schema';
import { AccountType } from '@/types/enums';

// -----------------------------------------------------------------------------
// Task 3D — Tax-bucket sequencing in retirement drawdown.
//
// Pre-fix: withdrawProportionally pulled from every investment account
// proportionally to balance. A retiree with $300k brokerage + $300k Trad 401k
// + $300k Roth saw a $90k withdrawal as $30k from each — defeating the
// standard textbook taxable → tax-deferred → Roth sequencing.
//
// Post-fix: payload.withdrawalStrategy = 'sequential' draws taxable first,
// then tax-deferred, then Roth. Default remains 'proportional' so existing
// scenarios are unchanged.
// -----------------------------------------------------------------------------

const accounts: Account[] = [
  { id: 1, householdId: 1, name: 'Brokerage', type: AccountType.ACCOUNT_BROKERAGE, excludedFromNetWorth: false } as unknown as Account,
  { id: 2, householdId: 1, name: 'Trad 401k', type: AccountType.ACCOUNT_401K,     excludedFromNetWorth: false } as unknown as Account,
  { id: 3, householdId: 1, name: 'Roth IRA',  type: AccountType.ACCOUNT_ROTH_IRA, excludedFromNetWorth: false } as unknown as Account,
];

function buildReal(opts: { brokerage: number; trad: number; roth: number }): RealState {
  return {
    accounts,
    holdings: [],
    loans: [],
    loanPayments: [],
    household: { id: 1, filingStatus: 'SINGLE' } as RealState['household'],
    persons: [{ id: 1, householdId: 1, displayName: 'A', annualSalaryPretax: 0, targetRetirementAge: 0 } as unknown as RealState['persons'][0]],
    accountsByBucket: {
      taxAdvantaged: [accounts[1], accounts[2]],
      brokerage: [accounts[0]],
      cash: [],
    },
    initialCash: 0,
    initialInvestmentsByAccount: {
      1: opts.brokerage,
      2: opts.trad,
      3: opts.roth,
    },
    cashAccountsWithBalances: [],
    defaults: { inflation: 0, returnRate: 0, defaultCashApy: null },
    startISO: '2026-01',
    taxBrackets: {
      federal: [{ min: 0, max: null, rate: 0 }],
      state: [],
      city: null,
      standardDeduction: { federal: 0, state: 0, city: 0 },
    },
  };
}

function buildPayload(strategy: 'proportional' | 'sequential' | undefined) {
  const p = emptyLeverPayload();
  // $5k/mo expense + zero income → forces withdrawals every step.
  p.expensePeriods = [{ start: '2026-01-01', monthlyDelta: 5000, durationMonths: 24 }];
  p.returns.defaultRate = 0;
  if (strategy !== undefined) {
    // Cast — the field is being added in this task.
    (p as unknown as { withdrawalStrategy: typeof strategy }).withdrawalStrategy = strategy;
  }
  return p;
}

describe('withdrawalStrategy = proportional (default, legacy behavior)', () => {
  it('draws from all three accounts proportional to balance', () => {
    const real = buildReal({ brokerage: 300_000, trad: 300_000, roth: 300_000 });
    const payload = buildPayload('proportional');
    const states = projectScenario(real, payload, { startISO: '2026-01', months: 13 });

    const end = states[states.length - 1];
    // 12 months × $5k = $60k drawn. Equal balances → $20k from each.
    expect(end.investmentsByAccount[1]).toBeCloseTo(280_000, -2);
    expect(end.investmentsByAccount[2]).toBeCloseTo(280_000, -2);
    expect(end.investmentsByAccount[3]).toBeCloseTo(280_000, -2);
  });

  it('omitting the field falls back to proportional (backward-compat)', () => {
    const real = buildReal({ brokerage: 100_000, trad: 200_000, roth: 100_000 });
    const payload = buildPayload(undefined);
    const states = projectScenario(real, payload, { startISO: '2026-01', months: 7 });

    const end = states[states.length - 1];
    // 6 months × $5k = $30k. Proportional draw from $400k total:
    // brokerage 100/400 × 30k = $7,500 drawn → ending 92,500
    // trad      200/400 × 30k = $15,000 drawn → ending 185,000
    // roth      100/400 × 30k = $7,500 drawn → ending 92,500
    expect(end.investmentsByAccount[1]).toBeCloseTo(92_500, -2);
    expect(end.investmentsByAccount[2]).toBeCloseTo(185_000, -2);
    expect(end.investmentsByAccount[3]).toBeCloseTo(92_500, -2);
  });
});

describe('withdrawalStrategy = sequential (taxable → tax-deferred → Roth)', () => {
  it('exhausts brokerage first, then Trad 401k, then Roth IRA', () => {
    // Set up so total $60k draw exhausts brokerage ($20k) entirely AND
    // dips into Trad 401k for the remaining $40k. Roth untouched.
    const real = buildReal({ brokerage: 20_000, trad: 100_000, roth: 100_000 });
    const payload = buildPayload('sequential');
    const states = projectScenario(real, payload, { startISO: '2026-01', months: 13 });

    const end = states[states.length - 1];
    // 12 × $5k = $60k drawn.
    // Brokerage: drained from $20k → ~$0.
    // Trad: drained $40k from $100k → ~$60k.
    // Roth: untouched → $100k.
    expect(end.investmentsByAccount[1]).toBeCloseTo(0, 0);
    expect(end.investmentsByAccount[2]).toBeCloseTo(60_000, -2);
    expect(end.investmentsByAccount[3]).toBeCloseTo(100_000, -2);
  });

  it('with sufficient brokerage, Trad and Roth stay untouched', () => {
    const real = buildReal({ brokerage: 200_000, trad: 100_000, roth: 100_000 });
    const payload = buildPayload('sequential');
    const states = projectScenario(real, payload, { startISO: '2026-01', months: 13 });

    const end = states[states.length - 1];
    // 12 × $5k = $60k. Brokerage absorbs the full draw.
    expect(end.investmentsByAccount[1]).toBeCloseTo(140_000, -2);
    expect(end.investmentsByAccount[2]).toBeCloseTo(100_000, -2);
    expect(end.investmentsByAccount[3]).toBeCloseTo(100_000, -2);
  });

  it('when brokerage and Trad are both exhausted, Roth is drawn last', () => {
    const real = buildReal({ brokerage: 10_000, trad: 20_000, roth: 100_000 });
    const payload = buildPayload('sequential');
    const states = projectScenario(real, payload, { startISO: '2026-01', months: 13 });

    const end = states[states.length - 1];
    // Total need: $60k. Brokerage gives $10k. Trad gives $20k. Roth covers $30k.
    expect(end.investmentsByAccount[1]).toBeCloseTo(0, 0);
    expect(end.investmentsByAccount[2]).toBeCloseTo(0, 0);
    expect(end.investmentsByAccount[3]).toBeCloseTo(70_000, -2);
  });
});
