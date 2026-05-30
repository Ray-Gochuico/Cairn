import { describe, it, expect } from 'vitest';
import { projectScenario } from '@/lib/scenarios/engine';
import { emptyLeverPayload } from '@/lib/scenarios/lever-types';
import { sequencingBucketForAccount } from '@/lib/account-tax-classification';
import type { RealState } from '@/lib/scenarios/state-snapshot';
import type { Account } from '@/types/schema';
import { AccountType } from '@/types/enums';

// ---------------------------------------------------------------------------
// Task 5 — Roth-401k tax-free drawdown fixture + exhaustiveness lock (A5).
//
// Proves the headline capability end-to-end: a Roth-401k account drains
// tax-free (roth tier, grossUp=false) while a Traditional-401k is grossed up
// (taxDeferred tier, grossUp=true at 0.22), all through the real
// projectScenario engine. Mirrors the withdrawal-strategy.test.ts fixture
// shape exactly — accounts + buildReal are modeled directly on that file.
//
// Also locks the ~9-site AccountType fan-out: a synthetic account type that
// is NOT in the enum must trip assertNever and throw, proving that a future
// ACCOUNT_FOO member cannot slip through half-wired.
// ---------------------------------------------------------------------------

const accounts: Account[] = [
  { id: 1, householdId: 1, name: 'Brokerage',  type: AccountType.ACCOUNT_BROKERAGE,  excludedFromNetWorth: false } as unknown as Account,
  { id: 2, householdId: 1, name: 'Trad 401k',  type: AccountType.ACCOUNT_401K,       excludedFromNetWorth: false } as unknown as Account,
  { id: 3, householdId: 1, name: 'Roth 401k',  type: AccountType.ACCOUNT_ROTH_401K,  excludedFromNetWorth: false } as unknown as Account,
];

function buildReal(opts: { brokerage: number; trad: number; roth: number }): RealState {
  return {
    accounts,
    holdings: [],
    loans: [],
    loanPayments: [],
    household: { id: 1, filingStatus: 'SINGLE' } as RealState['household'],
    persons: [
      {
        id: 1,
        householdId: 1,
        displayName: 'A',
        annualSalaryPretax: 0,
        targetRetirementAge: 0,
      } as unknown as RealState['persons'][0],
    ],
    accountsByBucket: {
      taxAdvantaged: [accounts[1], accounts[2]],
      brokerage: [accounts[0]],
      cash: [],
    },
    initialCash: 0,
    initialInvestmentsByAccount: { 1: opts.brokerage, 2: opts.trad, 3: opts.roth },
    cashAccountsWithBalances: [],
    defaults: { inflation: 0, returnRate: 0, defaultCashApy: null },
    startISO: '2026-01',
    taxBrackets: {
      federal: [{ min: 0, max: null, rate: 0 }],
      state: [],
      city: null,
      ltcg: [],
      standardDeduction: { federal: 0, state: 0, city: 0 },
    },
    housingPayments: [],
    vehicleLeases: [],
  } as unknown as RealState;
}

function buildPayload() {
  const p = emptyLeverPayload();
  // $5k/mo expense + zero income → forces withdrawals every step.
  p.expensePeriods = [{ start: '2026-01-01', monthlyDelta: 5000, durationMonths: 24 }];
  p.returns.defaultRate = 0;
  p.withdrawalStrategy = 'sequential';
  p.effectiveDrawdownTaxRate = 0.22;
  return p;
}

describe('Roth 401k drains tax-free in sequential drawdown', () => {
  it('Roth 401k is bucketed `roth` (drives the tax-free tier)', () => {
    expect(sequencingBucketForAccount(accounts[2])).toBe('roth');
  });

  it('Traditional 401k stays `taxDeferred` (Roth-401k addition must not move it)', () => {
    expect(sequencingBucketForAccount(accounts[1])).toBe('taxDeferred');
  });

  it('Trad 401k is grossed up while Roth 401k is untouched until last', () => {
    // 12 × $5k = $60k net needed.
    // Tier 1 — Brokerage ($10k, grossUp=false): delivers $10k net. Remaining = $50k.
    // Tier 2 — Trad 401k ($40k, grossUp=true at 0.22):
    //   idealGross = $50k / (1 - 0.22) = $64,102.56, capped at $40k (tier total).
    //   actualGross = $40k. netDelivered = $40k × 0.78 = $31,200. Remaining = $18,800.
    // Tier 3 — Roth 401k ($100k, grossUp=false):
    //   draws $18,800 tax-free. Remaining = $0.
    // Ending Roth = $100k − $18,800 = $81,200.
    const real = buildReal({ brokerage: 10_000, trad: 40_000, roth: 100_000 });
    const states = projectScenario(real, buildPayload(), { startISO: '2026-01', months: 13 });
    const end = states[states.length - 1];

    // Brokerage: exhausted.
    expect(end.investmentsByAccount[1]).toBeCloseTo(0, 0);
    // Trad: fully drained (all $40k grossed up to deliver $31.2k net).
    expect(end.investmentsByAccount[2]).toBeCloseTo(0, 0);
    // Roth: only $18,800 drawn tax-free → ~$81,200 remaining.
    // (The load-bearing proof: Roth draws TAX-FREE — same nominal amount
    // pulled is exactly what reduces the balance, with no gross-up multiplier.)
    expect(end.investmentsByAccount[3]).toBeCloseTo(81_200, -2);
  });

  it('with sufficient brokerage, BOTH Trad and Roth 401k stay untouched', () => {
    // 12 × $5k = $60k net. Brokerage $200k covers the full draw.
    const real = buildReal({ brokerage: 200_000, trad: 50_000, roth: 50_000 });
    const states = projectScenario(real, buildPayload(), { startISO: '2026-01', months: 13 });
    const end = states[states.length - 1];

    expect(end.investmentsByAccount[2]).toBeCloseTo(50_000, -2);
    expect(end.investmentsByAccount[3]).toBeCloseTo(50_000, -2);
  });

  it('Roth draws are NOT grossed up: same nominal withdrawal reduces the Roth balance directly', () => {
    // A Roth-only portfolio pulling $60k over 12 months.
    // grossUp=false → actualGross = remaining = net = $5k/mo. No inflation.
    // Ending Roth = $100k − $60k = $40k.
    const rothOnly: Account = {
      id: 3,
      householdId: 1,
      name: 'Roth 401k',
      type: AccountType.ACCOUNT_ROTH_401K,
      excludedFromNetWorth: false,
    } as unknown as Account;

    const real: RealState = {
      accounts: [rothOnly],
      holdings: [],
      loans: [],
      loanPayments: [],
      household: { id: 1, filingStatus: 'SINGLE' } as RealState['household'],
      persons: [
        {
          id: 1,
          householdId: 1,
          displayName: 'A',
          annualSalaryPretax: 0,
          targetRetirementAge: 0,
        } as unknown as RealState['persons'][0],
      ],
      accountsByBucket: {
        taxAdvantaged: [rothOnly],
        brokerage: [],
        cash: [],
      },
      initialCash: 0,
      initialInvestmentsByAccount: { 3: 100_000 },
      cashAccountsWithBalances: [],
      defaults: { inflation: 0, returnRate: 0, defaultCashApy: null },
      startISO: '2026-01',
      taxBrackets: {
        federal: [{ min: 0, max: null, rate: 0 }],
        state: [],
        city: null,
        ltcg: [],
        standardDeduction: { federal: 0, state: 0, city: 0 },
      },
      housingPayments: [],
      vehicleLeases: [],
    } as unknown as RealState;

    const p = emptyLeverPayload();
    p.expensePeriods = [{ start: '2026-01-01', monthlyDelta: 5000, durationMonths: 24 }];
    p.returns.defaultRate = 0;
    p.withdrawalStrategy = 'sequential';
    p.effectiveDrawdownTaxRate = 0.22; // high rate — must NOT affect the Roth tier

    const states = projectScenario(real, p, { startISO: '2026-01', months: 13 });
    const end = states[states.length - 1];

    // 12 × $5k = $60k withdrawn. grossUp=false for roth → balance drops by
    // exactly $60k (not $60k / 0.78 = $76.9k that a grossed-up draw would take).
    expect(end.investmentsByAccount[3]).toBeCloseTo(40_000, -2);
  });
});

describe('AccountType exhaustiveness lock (A4)', () => {
  it('a synthetic AccountType member trips assertNever until handled', () => {
    // A value outside the union simulates a future ACCOUNT_FOO added to the
    // enum but not yet handled in sequencingBucketForAccount. This is the
    // runtime proof of the compile-time guard: an unhandled member reaches
    // assertNever and throws rather than silently falling through the drawdown
    // engine (which previously used `default: return null` — wrong financial
    // numbers, not a crash).
    const synthetic = {
      id: 99,
      householdId: 1,
      name: 'Future Account',
      type: 'ACCOUNT_FUTURE_SYNTHETIC',
      excludedFromNetWorth: false,
    } as unknown as Account;

    expect(() => sequencingBucketForAccount(synthetic)).toThrow(
      /Unhandled value in exhaustive switch/,
    );
  });
});
