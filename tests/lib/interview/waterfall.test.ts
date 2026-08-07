import { describe, it, expect } from 'vitest';
import { splitAmount } from '@/lib/interview/waterfall';
import { computeBucketGaps, avalancheOrder } from '@/lib/interview/gaps';
import type { InterviewContext } from '@/types/interview';
import type { AccountSnapshot } from '@/types/schema';
import { AccountType, ContributionSource } from '@/types/enums';
import { makeHousehold, makePerson, makeAccount, makeLoan } from '../../factories';

const snap = (accountId: number, totalValue: number): AccountSnapshot =>
  ({ accountId, snapshotDate: '2026-07-30', totalValue } as AccountSnapshot);

export function fixtureCtx(overrides: Partial<InterviewContext> = {}): InterviewContext {
  return {
    household: makeHousehold({ monthlyExpenseBaseline: 6000 }),
    persons: [makePerson({ id: 1, jobStability: null })],
    accounts: [
      makeAccount({ id: 1, type: AccountType.ACCOUNT_SAVINGS, name: 'Savings' }),
      makeAccount({ id: 2, type: AccountType.ACCOUNT_CASH, name: 'Checking' }),
    ],
    snapshots: [snap(1, 22000), snap(2, 8000)],
    loans: [
      makeLoan({ id: 1, name: 'Mortgage', currentBalance: 540000, interestRate: 0.0625, monthlyPayment: 4001, termMonths: 360, firstPaymentDate: '2022-02-01' }),
      makeLoan({ id: 2, name: 'Visa', currentBalance: 3000, interestRate: 0.22, monthlyPayment: 150, termMonths: 36, firstPaymentDate: '2026-01-01' }),
      makeLoan({ id: 3, name: 'Car', currentBalance: 22000, interestRate: 0.049, monthlyPayment: 791, termMonths: 60, firstPaymentDate: '2025-02-01' }),
    ],
    contributions: [], transactions: [], categories: [], overrides: new Map(),
    thresholds: { low: 5, high: 8 }, taxYear: 2026,
    today: new Date('2026-08-01T12:00:00Z'),
    vehicles: [], assetValueSnapshots: [], settings: null, holdings: [], tickers: [],
    interviewAnswers: new Map(),
    ...overrides,
  } as InterviewContext;
}

const rowsOf = (s: ReturnType<typeof splitAmount>) =>
  s.rows.map((r) => [r.bucket, r.amountCents]);

describe('computeBucketGaps', () => {
  it('classifies bands on rate × 100 (the fraction seam) and orders avalanche', () => {
    const g = computeBucketGaps(fixtureCtx());
    expect(g.highLoans.map((l) => l.name)).toEqual(['Visa']);
    expect(g.midLoans.map((l) => l.name)).toEqual(['Mortgage']);
    expect(g.reserveDollars).toBe(30000);
    expect(g.efFloorGapCents).toBe(0);          // max(1000, 6000)=6000 ≤ 30000
    expect(g.ef6GapCents).toBe(600000);         // 36,000 − 30,000
    expect(g.ef3GapCents).toBe(0);              // 18,000 ≤ 30,000
    expect(g.highRateGapCents).toBe(300000);
  });
  it('avalanche tie-break: rate desc, then smaller balance, then lower id', () => {
    const loans = [
      makeLoan({ id: 9, currentBalance: 500, interestRate: 0.1 }),
      makeLoan({ id: 2, currentBalance: 200, interestRate: 0.1 }),
      makeLoan({ id: 1, currentBalance: 200, interestRate: 0.1 }),
      makeLoan({ id: 5, currentBalance: 100, interestRate: 0.2 }),
    ];
    expect(avalancheOrder(loans).map((l) => l.id)).toEqual([5, 1, 2, 9]);
  });
});

describe('splitAmount — one-time (hand-computed, design §3.1-3.4)', () => {
  const input = { amountCents: 1_000_000, cadence: 'one-time' as const };

  it('Conservative: fills B3, B4 (6×), then B5 fully', () => {
    const s = splitAmount(input, 'conservative', fixtureCtx());
    expect(rowsOf(s)).toEqual([
      ['high_rate_debt', 300000],
      ['ef_target', 600000],
      ['mid_rate_debt', 100000],
    ]);
    expect(s.skipped.map((k) => k.bucket)).toContain('ef_floor');
    expect(s.skipped.find((k) => k.bucket === 'ef_floor')!.reason)
      .toBe('Emergency fund already at 5.0× monthly expenses — skipped.');
    expect(s.skipped.find((k) => k.bucket === 'match')!.reason)
      .toBe("Employer match is captured through payroll deferral — a lump sum can't buy it directly.");
  });

  it('Moderate: unanswered jobStability → 6× ASSUMED; post-B4 remainder splits 50/50', () => {
    const s = splitAmount(input, 'moderate', fixtureCtx());
    expect(rowsOf(s)).toEqual([
      ['high_rate_debt', 300000],
      ['ef_target', 600000],
      ['mid_rate_debt', 50000],
      ['invest', 50000],
    ]);
    expect(s.efAssumed).toBe(true);
    expect(s.efMultiple).toBe(6);
  });

  it('Aggressive: 3× already covered; mid-rate stays at minimums; remainder invests', () => {
    const s = splitAmount(input, 'aggressive', fixtureCtx());
    expect(rowsOf(s)).toEqual([
      ['high_rate_debt', 300000],
      ['invest', 700000],
    ]);
    expect(s.skipped.find((k) => k.bucket === 'mid_rate_debt')!.reason)
      .toBe('Debt between 5–8% stays at minimum payments in this framework.');
  });

  it('D-GI11: the odd cent goes to the EARLIER bucket (B5), zero rows are dropped', () => {
    // $9,000.01 → B3 300,000 + B4 600,000 leaves 1¢ → B5 1¢, no invest row.
    const s = splitAmount({ amountCents: 900_001, cadence: 'one-time' }, 'moderate', fixtureCtx());
    expect(rowsOf(s)).toEqual([
      ['high_rate_debt', 300000],
      ['ef_target', 600000],
      ['mid_rate_debt', 1],
    ]);
  });

  it('PROPERTY: rows always sum exactly to the input, for every policy', () => {
    for (const amountCents of [1, 999, 100_000, 1_000_000, 123_456_789]) {
      for (const policy of ['conservative', 'moderate', 'aggressive'] as const) {
        const s = splitAmount({ amountCents, cadence: 'one-time' }, policy, fixtureCtx());
        expect(s.rows.reduce((a, r) => a + r.amountCents, 0)).toBe(amountCents);
      }
    }
  });

  it('PROPERTY: byte-identical output for identical inputs', () => {
    const a = splitAmount(input, 'moderate', fixtureCtx());
    const b = splitAmount(input, 'moderate', fixtureCtx());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('DEGRADATION: no baseline → EF buckets skipped with the CI-11 copy; money still lands', () => {
    const ctx = fixtureCtx({ household: makeHousehold({ monthlyExpenseBaseline: 0 }) });
    const s = splitAmount(input, 'conservative', fixtureCtx({ ...ctx }));
    expect(s.rows.reduce((a, r) => a + r.amountCents, 0)).toBe(1_000_000);
    expect(s.skipped.find((k) => k.bucket === 'ef_floor')!.reason)
      .toBe("Can't size your emergency fund — no expense baseline yet. Set one in Household or import transactions.");
    expect(s.rows.map((r) => r.bucket)).toEqual(['high_rate_debt', 'mid_rate_debt']);
  });

  it('DEGRADATION: no loans → both debt buckets skip with CI-16; all to EF then invest', () => {
    const s = splitAmount(input, 'conservative', fixtureCtx({ loans: [] }));
    expect(s.skipped.find((k) => k.bucket === 'high_rate_debt')!.reason).toBe('No loans on file.');
    expect(rowsOf(s)).toEqual([['ef_target', 600000], ['invest', 400000]]);
  });

  it('DEGRADATION: loans but none high-rate → CI-17 with the live threshold', () => {
    const s = splitAmount(input, 'aggressive',
      fixtureCtx({ loans: [makeLoan({ id: 1, name: 'Mortgage', currentBalance: 540000, interestRate: 0.0625 })] }));
    expect(s.skipped.find((k) => k.bucket === 'high_rate_debt')!.reason).toBe('No loans at or above 8%.');
  });
});

describe('splitAmount — per-month phases (design §3.3)', () => {
  const perMonth = { amountCents: 100_000, cadence: 'per-month' as const }; // $1,000/mo

  it('Conservative: EF-target phase is ceil(gap/flow); debt months come from the amortization schedule', () => {
    // Trivial-schedule loan: $1,000 @ 6% (mid band), payment $500, extra
    // $1,000/mo → month 1 pays 1,500 ≥ 1,005 → payoff in the first
    // schedule month → debt phase months = 1 (clamped ≥ 1).
    const ctx = fixtureCtx({
      loans: [makeLoan({ id: 1, name: 'Tiny', currentBalance: 1000, interestRate: 0.06, monthlyPayment: 500, termMonths: 12, firstPaymentDate: '2026-09-01' })],
    });
    const s = splitAmount(perMonth, 'conservative', ctx);
    // Phase 1: B4 gap $6,000 at $1,000/mo → 6 months. Phase 2: Tiny → 1 month. Phase 3: ongoing invest.
    expect(s.phases.map((p) => [p.months, p.rows.map((r) => r.bucket)])).toEqual([
      [6, ['ef_target']],
      [1, ['mid_rate_debt']],
      [null, ['invest']],
    ]);
    // Every phase's rows sum to the flow (the per-month sum invariant):
    for (const p of s.phases) {
      expect(p.rows.reduce((a, r) => a + r.amountCents, 0)).toBe(100_000);
    }
    expect(s.rows).toEqual(s.phases[0].rows);
  });

  it('Moderate: steady state splits mid-rate/invest 50/50 until the band clears, then ongoing invest', () => {
    const ctx = fixtureCtx({
      loans: [makeLoan({ id: 1, name: 'Tiny', currentBalance: 1000, interestRate: 0.06, monthlyPayment: 500, termMonths: 12, firstPaymentDate: '2026-09-01' })],
    });
    const s = splitAmount(perMonth, 'moderate', ctx);
    const last2 = s.phases.slice(-2);
    expect(last2[0].rows.map((r) => [r.bucket, r.amountCents])).toEqual([
      ['mid_rate_debt', 50000],
      ['invest', 50000],
    ]);
    expect(last2[1]).toEqual({ months: null, rows: [{ bucket: 'invest', amountCents: 100_000 }] });
  });

  it('B2 carve-out is deducted first in EVERY phase and labeled through December', () => {
    const matchedCtx = fixtureCtx({
      persons: [makePerson({ id: 1, name: 'Sam', annualSalaryPretax: 100000, jobStability: null })],
      accounts: [
        ...fixtureCtx().accounts,
        makeAccount({ id: 10, type: AccountType.ACCOUNT_401K, name: '401(k)', ownerPersonId: 1, hasEmployerMatch: true, employerMatchPct: 0.03, employerMatchLimitPct: 0.06 }),
      ],
      contributions: [{ accountId: 10, date: '2026-03-15', amount: 2000, source: ContributionSource.PAYCHECK }] as never,
      loans: [],
    });
    const s = splitAmount(perMonth, 'conservative', matchedCtx);
    // carve = $800/mo (match test above); avail = $200/mo; B4 gap $6,000 → 30 months.
    expect(s.phases[0].months).toBe(30);
    expect(s.phases[0].rows).toEqual([
      { bucket: 'match', amountCents: 80000 },
      { bucket: 'ef_target', amountCents: 20000 },
    ]);
    expect(s.phases.at(-1)!.rows[0]).toEqual({ bucket: 'match', amountCents: 80000 });
  });

  it('match unknown → per-month skip carries CI-13 (unlike the one-time CI-12)', () => {
    const ctx = fixtureCtx({
      accounts: [...fixtureCtx().accounts, makeAccount({ id: 11, type: AccountType.ACCOUNT_ROTH_IRA, hasEmployerMatch: null })],
    });
    const s = splitAmount(perMonth, 'aggressive', ctx);
    expect(s.skipped.find((k) => k.bucket === 'match')!.reason)
      .toBe('Employer match unknown — answer the match question on the Roadmap to include it.');
  });
});
