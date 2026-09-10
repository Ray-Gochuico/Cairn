import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  evaluateSmallEmergencyFund,
  evaluateEmergencyFund3Months,
  evaluateEmergencyFund6To12Months,
  totalCashReserve,
  efContext,
  baselineSuffix,
  MIN_COMPLETE_MONTHS,
} from '@/domain/roadmap/rules/emergencyFund';
import { rolling12mBaselineDetail } from '@/lib/expense-baseline';
import { ADVICE_LEXICON } from '../../../helpers/advice-lexicon';
import type { RoadmapContext } from '@/types/roadmap';
import type { Account, AccountSnapshot, Category, Household, Person, Transaction } from '@/types/schema';
import { AccountType, CategoryType, SnapshotSource } from '@/types/enums';
import { makeHousehold } from '../../../factories';
import { dateFromLocalISO, localTodayISO } from '@/lib/dates';


function makePerson(stability: 'stable' | 'unstable' | null = null): Person {
  return {
    id: 1,
    householdId: 1,
    name: 'Alex',
    dateOfBirth: '1990-01-01',
    targetRetirementAge: 65,
    annualSalaryPretax: 100_000,
    expectedBonus: 0,
    expectedBonusFrequency: 'ANNUAL',
    bonusIsConsistent: true,
    expectedCommission: 0,
    expectedCommissionFrequency: 'MONTHLY',
    employmentType: 'SALARY_NO_OT',
    hourlyRate: null,
    regularHoursPerWeek: 40,
    otThresholdHoursPerWeek: null,
    pretax401kPct: 0,
    healthInsuranceMonthlyPremium: 0,
    dependentCareFsaMonthly: 0,
    hsaMonthlyContribution: 0,
    hsaEligible: false,
    jobStability: stability,
    expectsHigherFutureIncome: null,
    onParentHealthInsurance: null,
    isRelativelyHealthy: null,
  };
}

function makeAccount(id: number, type: AccountType, patch: Partial<Account> = {}): Account {
  return {
    id,
    householdId: 1,
    ownerPersonId: null,
    beneficiaryDependentId: null,
    name: `Acct ${id}`,
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
    ...patch,
  };
}

function makeSnapshot(accountId: number, totalValue: number, date = '2026-05-01'): AccountSnapshot {
  return {
    id: accountId,
    accountId,
    snapshotDate: date,
    totalValue,
    source: SnapshotSource.MANUAL,
  };
}

function makeContext(opts: {
  baseline?: number;
  cash?: number;
  hsa?: number;
  savings?: number;
  stability?: 'stable' | 'unstable' | null;
  transactions?: Transaction[];
  categories?: Category[];
} = {}): RoadmapContext {
  const accounts: Account[] = [];
  const snapshots: AccountSnapshot[] = [];
  if (opts.cash !== undefined) {
    accounts.push(makeAccount(1, AccountType.ACCOUNT_CASH));
    snapshots.push(makeSnapshot(1, opts.cash));
  }
  if (opts.savings !== undefined) {
    accounts.push(makeAccount(2, AccountType.ACCOUNT_SAVINGS));
    snapshots.push(makeSnapshot(2, opts.savings));
  }
  if (opts.hsa !== undefined) {
    accounts.push(makeAccount(3, AccountType.ACCOUNT_HSA));
    snapshots.push(makeSnapshot(3, opts.hsa));
  }
  return {
    household: makeHousehold({ monthlyExpenseBaseline: opts.baseline ?? 5000 }),
    persons: opts.stability !== undefined ? [makePerson(opts.stability)] : [],
    accounts,
    loans: [],
    contributions: [],
    snapshots,
    transactions: opts.transactions ?? [],
    categories: opts.categories ?? [],
    overrides: new Map(),
    thresholds: { low: 5, high: 8 },
    taxYear: 2026,
    today: new Date('2026-05-23T12:00:00Z'),
  };
}

function tx(id: number, date: string, amount: number, patch: Partial<Transaction> = {}): Transaction {
  return ({
    id,
    householdId: 1,
    date,
    amount,
    merchant: 'M',
    merchantRaw: null,
    categoryId: 1,
    sourceAccountId: 1,
    reimbursable: false,
    reimbursedAt: null,
    reimbursedAmount: null,
    ...patch,
  } as unknown) as Transaction;
}

describe('totalCashReserve', () => {
  it('sums CASH + SAVINGS + HSA latest snapshot values', () => {
    const ctx = makeContext({ cash: 1500, savings: 4000, hsa: 800 });
    expect(totalCashReserve(ctx.accounts, ctx.snapshots)).toBe(6300);
  });

  it('ignores non-cash account types', () => {
    const accounts = [
      makeAccount(1, AccountType.ACCOUNT_BROKERAGE),
      makeAccount(2, AccountType.ACCOUNT_401K),
    ];
    const snapshots = [makeSnapshot(1, 100_000), makeSnapshot(2, 50_000)];
    expect(totalCashReserve(accounts, snapshots)).toBe(0);
  });

  it('uses the latest snapshot per account', () => {
    const accounts = [makeAccount(1, AccountType.ACCOUNT_CASH)];
    const snapshots = [
      makeSnapshot(1, 100, '2026-01-01'),
      makeSnapshot(1, 300, '2026-05-01'),
      makeSnapshot(1, 200, '2026-03-01'),
    ];
    expect(totalCashReserve(accounts, snapshots)).toBe(300);
  });

  it('excluded-from-net-worth cash accounts do NOT count toward the reserve', () => {
    const accounts = [
      makeAccount(1, AccountType.ACCOUNT_CASH),
      makeAccount(2, AccountType.ACCOUNT_SAVINGS, { excludedFromNetWorth: true }),
    ];
    const snapshots = [makeSnapshot(1, 4000), makeSnapshot(2, 6000)];
    expect(totalCashReserve(accounts, snapshots)).toBe(4000);
  });

  it('treats negative snapshots as zero (overdrawn shouldn\'t reduce target met)', () => {
    const accounts = [makeAccount(1, AccountType.ACCOUNT_CASH)];
    const snapshots = [makeSnapshot(1, -500)];
    expect(totalCashReserve(accounts, snapshots)).toBe(0);
  });
});

describe('evaluateSmallEmergencyFund', () => {
  it('returns unanswered when baseline is zero', () => {
    const r = evaluateSmallEmergencyFund(makeContext({ baseline: 0, cash: 5000 }));
    expect(r.status).toBe('unanswered');
  });

  it('target is max($1k, 1 × baseline) — sub-$1k baseline still requires $1k', () => {
    // Baseline $500 → target $1000.
    const below = evaluateSmallEmergencyFund(makeContext({ baseline: 500, cash: 900 }));
    expect(below.status).toBe('active');
    const meets = evaluateSmallEmergencyFund(makeContext({ baseline: 500, cash: 1000 }));
    expect(meets.status).toBe('done');
  });

  it('marks active when cash falls short of the 1× baseline target', () => {
    const r = evaluateSmallEmergencyFund(makeContext({ baseline: 5000, cash: 2000 }));
    expect(r.status).toBe('active');
    expect(r.evidence).toMatch(/\$2,000/);
    expect(r.evidence).toMatch(/\$5,000/);
    expect(r.cta).toBeDefined();
  });

  it('marks done when cash meets the 1× baseline target', () => {
    const r = evaluateSmallEmergencyFund(makeContext({ baseline: 5000, cash: 5000 }));
    expect(r.status).toBe('done');
  });

  it('marks done when cash exceeds the target (no over-funding warning)', () => {
    const r = evaluateSmallEmergencyFund(makeContext({ baseline: 5000, cash: 50_000 }));
    expect(r.status).toBe('done');
  });
});

describe('evaluateEmergencyFund3Months', () => {
  it('returns not-started when stability question is unanswered', () => {
    const r = evaluateEmergencyFund3Months(makeContext({ baseline: 5000, cash: 15_000 }));
    expect(r.status).toBe('not-started');
  });

  it('skips when stability is unstable (off-branch)', () => {
    const r = evaluateEmergencyFund3Months(makeContext({ baseline: 5000, cash: 50_000, stability: 'unstable' }));
    expect(r.status).toBe('skipped');
  });

  it('returns active when stable and cash < 3 × baseline', () => {
    const r = evaluateEmergencyFund3Months(makeContext({ baseline: 5000, cash: 10_000, stability: 'stable' }));
    expect(r.status).toBe('active');
    expect(r.evidence).toMatch(/\$10,000/);
    expect(r.evidence).toMatch(/\$15,000/);
  });

  it('returns done at exactly 3 × baseline', () => {
    const r = evaluateEmergencyFund3Months(makeContext({ baseline: 5000, cash: 15_000, stability: 'stable' }));
    expect(r.status).toBe('done');
  });
});

describe('evaluateEmergencyFund6To12Months', () => {
  it('returns not-started when stability question is unanswered', () => {
    const r = evaluateEmergencyFund6To12Months(makeContext({ baseline: 5000, cash: 60_000 }));
    expect(r.status).toBe('not-started');
  });

  it('skips when stability is stable (off-branch)', () => {
    const r = evaluateEmergencyFund6To12Months(makeContext({ baseline: 5000, cash: 60_000, stability: 'stable' }));
    expect(r.status).toBe('skipped');
  });

  it('returns active when unstable and cash < 6 × baseline', () => {
    const r = evaluateEmergencyFund6To12Months(makeContext({ baseline: 5000, cash: 15_000, stability: 'unstable' }));
    expect(r.status).toBe('active');
    expect(r.evidence).toMatch(/\$15,000/);
    expect(r.evidence).toMatch(/\$30,000/);
  });

  it('returns done at exactly 6 × baseline (the floor)', () => {
    const r = evaluateEmergencyFund6To12Months(makeContext({ baseline: 5000, cash: 30_000, stability: 'unstable' }));
    expect(r.status).toBe('done');
    expect(r.evidence).toMatch(/6-mo floor/);
  });

  it('returns done with ceiling evidence when cash hits 12 × baseline', () => {
    const r = evaluateEmergencyFund6To12Months(makeContext({ baseline: 5000, cash: 60_000, stability: 'unstable' }));
    expect(r.status).toBe('done');
    expect(r.evidence).toMatch(/12-mo ceiling/);
  });

  it('counts HSA balance toward the EF reserve', () => {
    const r = evaluateEmergencyFund6To12Months(
      makeContext({ baseline: 5000, cash: 10_000, hsa: 20_000, stability: 'unstable' }),
    );
    expect(r.status).toBe('done');
  });
});

describe('emergency-fund rule — real expense baseline from COMPLETE months (R1)', () => {
  it('prefers the complete-month average over the household baseline and states the count', () => {
    // Mar + Apr complete at $4,000 each; the May row is in-progress and does not count.
    // 3-mo target = $12,000; cash $12,500 → done. First real row 03-05 (guard inert).
    const transactions = [tx(1, '2026-03-05', 4000), tx(2, '2026-04-10', 4000), tx(3, '2026-05-10', 4000)];
    const r = evaluateEmergencyFund3Months(makeContext({ baseline: 5000, cash: 12_500, stability: 'stable', transactions }));
    expect(r.status).toBe('done');
    expect(r.evidence).toBe('$12,500 cash ≥ $12,000 (3-mo target from 2 months of spending)');
  });

  it('falls back to the household baseline when no transactions exist', () => {
    const r = evaluateEmergencyFund3Months(makeContext({ baseline: 5000, cash: 15_000, stability: 'stable', transactions: [] }));
    expect(r.status).toBe('done');
    expect(r.evidence).toBe('$15,000 cash ≥ $15,000 (3-mo target from Household)');
  });

  it('divides by months observed — 3 complete months yield total/3, not total/12; the in-progress row is ignored', () => {
    const transactions = [tx(1, '2026-02-05', 3000), tx(2, '2026-03-15', 3000), tx(3, '2026-04-15', 3000), tx(4, '2026-05-15', 3000)];
    const r = evaluateEmergencyFund6To12Months(makeContext({ baseline: 0, cash: 18_000, stability: 'unstable', transactions }));
    expect(r.status).toBe('done');
    expect(r.evidence).toBe('$18,000 cash ≥ $18,000 (6-mo floor from 3 months of spending)');
  });

  it('small EF target picks the transactions-derived floor; n = 1 pluralizes as "month"', () => {
    // April complete at $600 → target max($1,000, $600) = $1,000; cash $900 → active.
    const transactions = [tx(1, '2026-04-05', 600), tx(2, '2026-05-10', 600)];
    const r = evaluateSmallEmergencyFund(makeContext({ baseline: 5000, cash: 900, transactions }));
    expect(r.status).toBe('active');
    expect(r.evidence).toBe('$900 / $1,000 (90% from 1 month of spending)');
  });
});

describe('EF baseline uses REAL spending — transfers and reimbursements excluded (Wave 2 §8)', () => {
  const spendCat: Category = {
    id: 1, name: 'Everything', parentCategoryId: null, color: null, icon: null,
    type: CategoryType.NEED, isCapital: false, systemManaged: false, monthlyBudget: null,
  };
  const transferCat: Category = {
    ...spendCat, id: 9, name: 'CC Payments', type: CategoryType.TRANSFER,
  };

  it('credit-card-payment transfers no longer inflate the EF target', () => {
    // $8k/mo of transfers + $2k/mo of real spending for 3 months.
    const transactions = [
      tx(1, '2026-03-05', 8000, { categoryId: 9 }),
      tx(2, '2026-04-05', 8000, { categoryId: 9 }),
      tx(3, '2026-05-05', 8000, { categoryId: 9 }),
      tx(4, '2026-03-06', 2000),
      tx(5, '2026-04-10', 2000),
      tx(6, '2026-05-10', 2000),
    ];
    const ctx = makeContext({
      cash: 2500,
      transactions,
      categories: [spendCat, transferCat],
    });
    const r = evaluateSmallEmergencyFund(ctx);
    // Real baseline = $2,000/mo over the two COMPLETE months (Mar + Apr; the May
    // rows are in-progress) → small-EF target = max($1k, $2k) = $2,000;
    // $2,500 cash meets it. The raw-amount baseline said $10k/mo → active at 25%.
    expect(r.status).toBe('done');
    expect(r.evidence).toBe('$2,500 cash ≥ $2,000 target from 2 months of spending');
  });

  it('pending reimbursables are excluded; reimbursed ones count at net out-of-pocket', () => {
    // R1: sited in APRIL — a COMPLETE month (every row used to sit in the
    // as-of month, which no longer counts). The pending row is not a
    // real-spending row, so the history's first real row is 04-03 (guard inert).
    const transactions = [
      tx(1, '2026-04-02', 3000, { reimbursable: true }),                                   // pending → excluded
      tx(2, '2026-04-03', 1000, { reimbursable: true, reimbursedAt: '2026-04-20', reimbursedAmount: 800 }), // → $200
      tx(3, '2026-04-04', 1800),
    ];
    const ctx = makeContext({ cash: 100, transactions, categories: [spendCat] });
    const r = evaluateSmallEmergencyFund(ctx);
    // Baseline = (200 + 1800) / 1 month = $2,000 → target $2,000.
    expect(r.evidence).toBe('$100 / $2,000 (5% from 1 month of spending)');
  });

  it('all-transfer history falls back to the household baseline (from Household suffix)', () => {
    // R1 (review REFUTED 3 residual): sited in APRIL, a COMPLETE month, so the
    // fixture still tests "transfers only" rather than going vacuous because
    // its single row sits in the in-progress month.
    const transactions = [tx(1, '2026-04-05', 8000, { categoryId: 9 })];
    const ctx = makeContext({
      baseline: 5000, cash: 100, transactions, categories: [spendCat, transferCat],
    });
    const r = evaluateSmallEmergencyFund(ctx);
    expect(r.evidence).toBe('$100 / $5,000 (2% from Household)');
  });
});


describe('efContext — source gate: MIN_COMPLETE_MONTHS complete months with real spending > 0 (R1)', () => {
  const spendCat: Category = { id: 1, name: 'Everything', parentCategoryId: null, color: null, icon: null, type: CategoryType.NEED, isCapital: false, systemManaged: false, monthlyBudget: null };

  it('exports N = 1 (⚑ R1-F2 — CR-R1-9 is written for this value)', () => {
    expect(MIN_COMPLETE_MONTHS).toBe(1);
  });

  it('rows only in the in-progress month → Household, monthsObserved 0', () => {
    const ctx = makeContext({ baseline: 6000, cash: 100, transactions: [tx(1, '2026-05-02', 1200)], categories: [spendCat] });
    expect(efContext(ctx)).toEqual({ baseline: 6000, cash: 100, baselineSource: 'household', monthsObserved: 0 });
    expect(evaluateSmallEmergencyFund(ctx).evidence).toBe('$100 / $6,000 (2% from Household)');
  });

  it('one complete month → transactions, monthsObserved 1; three → 3', () => {
    const one = makeContext({ baseline: 6000, cash: 100, transactions: [tx(1, '2026-04-03', 1200)], categories: [spendCat] });
    expect(efContext(one)).toMatchObject({ baseline: 1200, baselineSource: 'transactions', monthsObserved: 1 });
    const three = makeContext({ baseline: 6000, cash: 100, transactions: [tx(1, '2026-02-03', 1000), tx(2, '2026-03-03', 2000), tx(3, '2026-04-03', 3000)], categories: [spendCat] });
    expect(efContext(three)).toMatchObject({ baseline: 2000, baselineSource: 'transactions', monthsObserved: 3 });
  });

  it('a complete month whose only real-spending rows are fully reimbursed is observed at $0 → the average > 0 half of the gate sends it to Household', () => {
    const ctx = makeContext({
      baseline: 6000, cash: 100, categories: [spendCat],
      transactions: [tx(1, '2026-04-03', 500, { reimbursable: true, reimbursedAt: '2026-04-10', reimbursedAmount: 500 })],
    });
    expect(rolling12mBaselineDetail(ctx.transactions, ctx.categories ?? [], '2026-05-23')).toMatchObject({ average: 0, monthsObserved: 1 });
    expect(efContext(ctx)).toMatchObject({ baseline: 6000, baselineSource: 'household', monthsObserved: 0 });
  });

  it('R1-F6 at the consumer: a history beginning on the 20th loses that month and says so in the count', () => {
    const ctx = makeContext({ baseline: 6000, cash: 100, transactions: [tx(1, '2026-03-20', 1000), tx(2, '2026-04-10', 3000)], categories: [spendCat] });
    expect(efContext(ctx)).toMatchObject({ baseline: 3000, baselineSource: 'transactions', monthsObserved: 1 });
    expect(evaluateSmallEmergencyFund(ctx).evidence).toBe('$100 / $3,000 (3% from 1 month of spending)');
  });

  it('no new string carries an advice lexeme or an exclamation (CR-R1-1/2)', () => {
    for (const n of [1, 2, 3, 12]) {
      const s = baselineSuffix('transactions', n);
      expect(s).not.toMatch(ADVICE_LEXICON);
      expect(s).not.toContain('!');
      expect(s).toBe(n === 1 ? ' from 1 month of spending' : ` from ${n} months of spending`);
    }
    expect(baselineSuffix('household', 0)).toBe(' from Household');
    expect(baselineSuffix('none', 0)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// W4 review (MINOR 6), restated for the complete-month rule (R1): the as-of day
// is the LOCAL day. East of UTC, `toISOString()` on a local-midnight `today`
// reports the PREVIOUS day — on the 1st that rolls the as-of month back, so the
// month that JUST COMPLETED would fall out of the window and the household
// would drop to its Household fallback. West-of-UTC zones share the UTC day
// and are controls. Two rows with DISTINCT amounts: a window that still
// counts the in-progress month reads (1,200 + 5,000) / 2 = $3,100, not $1,200.
// (Historical note: under the pre-R1 inclusive window this class made the
// sample profile's 6.7x reserve read as 5.1x — the T2 UTC lesson.)
// ---------------------------------------------------------------------------
describe('efContext as-of anchoring (local day, not UTC) — complete-month rule', () => {
  const originalTZ = process.env.TZ;

  afterEach(() => {
    vi.useRealTimers();
    process.env.TZ = originalTZ;
  });

  const spendCat: Category = {
    id: 1, name: 'Everything', parentCategoryId: null, color: null, icon: null,
    type: CategoryType.NEED, isCapital: false, systemManaged: false, monthlyBudget: null,
  };

  /** The production derivation, verbatim: context.ts's `today` field. */
  function contextForToday(transactions: Transaction[], categories: Category[]): RoadmapContext {
    return {
      ...makeContext({ baseline: 6000, cash: 30_000, transactions, categories }),
      today: dateFromLocalISO(localTodayISO()),
    };
  }

  const AUGUST = [tx(1, '2026-08-03', 700), tx(2, '2026-08-31', 500)]; // one complete month, $1,200; first real row on the 3rd (guard inert)
  const SEPT_1 = tx(3, '2026-09-01', 5000);                             // the in-progress month — must NOT count

  it.each([
    ['Pacific/Auckland', '2026-08-31T12:00:00.000Z'], // = 2026-09-01 00:00 NZST (UTC+12)
    ['Asia/Tokyo', '2026-08-31T15:00:00.000Z'], // = 2026-09-01 00:00 JST (UTC+9)
    ['America/Los_Angeles', '2026-09-01T07:00:00.000Z'], // = 2026-09-01 00:00 PDT (control)
    ['UTC', '2026-09-01T00:00:00.000Z'], // CI's zone (control)
  ])('on the local 1st in %s, August is complete and September is not', (tz, instant) => {
    process.env.TZ = tz;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(instant));
    expect(localTodayISO()).toBe('2026-09-01'); // precondition: it IS the 1st, locally

    const r = evaluateSmallEmergencyFund(contextForToday([...AUGUST, SEPT_1], [spendCat]));
    expect(r.evidence).toBe('$30,000 cash ≥ $1,200 target from 1 month of spending');
    // Only in-progress rows → the Household fallback, stated.
    const only = evaluateSmallEmergencyFund(contextForToday([SEPT_1], [spendCat]));
    expect(only.evidence).toBe('$30,000 cash ≥ $6,000 target from Household');
  });
});

// Ruling 7: the recorded bug class pinned at the CONSUMER across a local month
// boundary — a row posting on the 1st must not move the figure.
describe('efContext — cross-month-boundary anchor: a row posting on the 1st never moves the figure', () => {
  const originalTZ = process.env.TZ;
  afterEach(() => { process.env.TZ = originalTZ; });

  const spendCat: Category = {
    id: 1, name: 'Everything', parentCategoryId: null, color: null, icon: null,
    type: CategoryType.NEED, isCapital: false, systemManaged: false, monthlyBudget: null,
  };

  const THREE = [tx(1, '2026-04-01', 5800), tx(2, '2026-05-01', 5911.12), tx(3, '2026-06-01', 6022.24)]; // avg 5,911.12
  const JULY_1 = tx(4, '2026-07-01', 96.31);
  const at = (iso: string, transactions: Transaction[]): RoadmapContext =>
    ({ ...makeContext({ baseline: 6000, cash: 30_000, transactions, categories: [spendCat] }), today: dateFromLocalISO(iso) });

  it.each(['Pacific/Auckland', 'America/Los_Angeles', 'UTC'])('in %s', (tz) => {
    process.env.TZ = tz;
    for (const iso of ['2026-07-01', '2026-07-15', '2026-07-31']) {
      const ctx = at(iso, [...THREE, JULY_1]);
      expect(localTodayISO(ctx.today)).toBe(iso); // precondition: the local round trip
      expect(efContext(ctx).baseline).toBeCloseTo(5911.12, 2);
      expect(efContext(ctx).monthsObserved).toBe(3);
      expect(evaluateSmallEmergencyFund(ctx).evidence).toBe('$30,000 cash ≥ $5,911 target from 3 months of spending');
      expect(efContext(ctx)).toEqual(efContext(at(iso, THREE))); // the July-1 row is invisible
    }
    // June 30: the two-month figure — the single move on the 1st is JUNE entering, not the July row.
    expect(evaluateSmallEmergencyFund(at('2026-06-30', [...THREE, JULY_1])).evidence)
      .toBe('$30,000 cash ≥ $5,856 target from 2 months of spending'); // (5800 + 5911.12) / 2 = 5,855.56
  });
});
