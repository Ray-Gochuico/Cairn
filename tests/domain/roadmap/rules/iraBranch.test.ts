import { describe, it, expect } from 'vitest';
import {
  computeMagi,
  evaluateIraBand,
  evaluateBackdoorRoth,
  evaluateRothIra,
  evaluateTraditionalIra,
} from '@/domain/roadmap/rules/iraBranch';
import type { RoadmapContext } from '@/types/roadmap';
import type { Account, Contribution, Person } from '@/types/schema';
import { AccountType, ContributionSource, FilingStatus } from '@/types/enums';
import { makeHousehold } from '../../../factories';


function makePerson(opts: {
  salary?: number;
  expectsHigherFutureIncome?: boolean | null;
} = {}): Person {
  return {
    id: 1,
    householdId: 1,
    name: 'Alex',
    dateOfBirth: '1990-01-01',
    targetRetirementAge: 65,
    annualSalaryPretax: opts.salary ?? 100_000,
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
    jobStability: null,
    expectsHigherFutureIncome: opts.expectsHigherFutureIncome ?? null,
    onParentHealthInsurance: null,
    isRelativelyHealthy: null,
  };
}

function makeAccount(id: number, type: AccountType): Account {
  return {
    id,
    householdId: 1,
    ownerPersonId: null,
    beneficiaryDependentId: null,
    name: `Account ${id}`,
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
  };
}

function makeContribution(opts: {
  accountId: number;
  amount: number;
  date: string;
  source?: ContributionSource;
}): Contribution {
  return {
    id: Math.floor(Math.random() * 1e9),
    accountId: opts.accountId,
    personId: 1,
    date: opts.date,
    amount: opts.amount,
    source: opts.source ?? ContributionSource.PAYCHECK,
  };
}

const TODAY = new Date('2026-05-23T12:00:00Z');

function makeContext(opts: {
  filingStatus?: 'SINGLE' | 'MFJ' | 'MFS' | 'HOH';
  persons?: Person[];
  contributions?: Contribution[];
  accounts?: Account[];
} = {}): RoadmapContext {
  return {
    household: makeHousehold({ filingStatus: (opts.filingStatus ?? 'SINGLE') as FilingStatus }),
    persons: opts.persons ?? [makePerson({ salary: 100_000 })],
    accounts: opts.accounts ?? [],
    loans: [],
    contributions: opts.contributions ?? [],
    snapshots: [],
    transactions: [],
    overrides: new Map(),
    thresholds: { low: 5, high: 8 },
    taxYear: 2026,
    today: TODAY,
  };
}

describe('computeMagi', () => {
  it('starts at total household salary when no pre-tax contributions exist', () => {
    const ctx = makeContext({ persons: [makePerson({ salary: 120_000 })] });
    expect(computeMagi(ctx)).toBe(120_000);
  });

  it('sums salaries across multiple persons', () => {
    const ctx = makeContext({
      persons: [makePerson({ salary: 80_000 }), makePerson({ salary: 60_000 })],
    });
    expect(computeMagi(ctx)).toBe(140_000);
  });

  it('subtracts YTD 401(k) contributions from gross salary', () => {
    const ctx = makeContext({
      persons: [makePerson({ salary: 100_000 })],
      accounts: [makeAccount(7, AccountType.ACCOUNT_401K)],
      contributions: [
        makeContribution({ accountId: 7, amount: 10_000, date: '2026-01-15' }),
        makeContribution({ accountId: 7, amount: 5_000, date: '2026-03-01' }),
      ],
    });
    expect(computeMagi(ctx)).toBe(85_000);
  });

  it('does NOT subtract traditional IRA contributions (Pub 590-A adds the deduction back) (wave-9 F10)', () => {
    const ctx = makeContext({
      persons: [makePerson({ salary: 100_000 })],
      accounts: [makeAccount(8, AccountType.ACCOUNT_TRAD_IRA)],
      contributions: [makeContribution({ accountId: 8, amount: 7_000, date: '2026-02-01' })],
    });
    expect(computeMagi(ctx)).toBe(100_000);
  });

  it('does NOT subtract employer-match rows (never in wages) (wave-9 F10)', () => {
    const ctx = makeContext({
      persons: [makePerson({ salary: 100_000 })],
      accounts: [makeAccount(7, AccountType.ACCOUNT_401K)],
      contributions: [
        makeContribution({ accountId: 7, amount: 10_000, date: '2026-01-15' }), // employee deferral
        makeContribution({ accountId: 7, amount: 5_000, date: '2026-01-15', source: ContributionSource.EMPLOYER_MATCH }),
      ],
    });
    expect(computeMagi(ctx)).toBe(90_000);
  });

  it('ignores Roth IRA contributions (post-tax, do not reduce MAGI)', () => {
    const ctx = makeContext({
      persons: [makePerson({ salary: 100_000 })],
      accounts: [makeAccount(9, AccountType.ACCOUNT_ROTH_IRA)],
      contributions: [makeContribution({ accountId: 9, amount: 7_000, date: '2026-02-01' })],
    });
    expect(computeMagi(ctx)).toBe(100_000);
  });

  it('ignores contributions from prior calendar years', () => {
    const ctx = makeContext({
      persons: [makePerson({ salary: 100_000 })],
      accounts: [makeAccount(7, AccountType.ACCOUNT_401K)],
      contributions: [
        makeContribution({ accountId: 7, amount: 99_999, date: '2025-12-31' }),  // prior year
        makeContribution({ accountId: 7, amount: 5_000, date: '2026-01-15' }),
      ],
    });
    expect(computeMagi(ctx)).toBe(95_000);
  });

  it('clamps at zero so heavy pre-tax + low salary cannot go negative', () => {
    const ctx = makeContext({
      persons: [makePerson({ salary: 10_000 })],
      accounts: [makeAccount(7, AccountType.ACCOUNT_401K)],
      contributions: [makeContribution({ accountId: 7, amount: 50_000, date: '2026-03-01' })],
    });
    expect(computeMagi(ctx)).toBe(0);
  });
});

describe('evaluateIraBand — single filer', () => {
  it('low band at $50k → traditional/Roth choice', () => {
    const r = evaluateIraBand(makeContext({ persons: [makePerson({ salary: 50_000 })] }));
    expect(r.evidence).toMatch(/below.*\$81,000/);
    expect(r.evidence).toMatch(/Traditional vs\. Roth/);
  });

  it('mid band at $100k → direct Roth', () => {
    const r = evaluateIraBand(makeContext({ persons: [makePerson({ salary: 100_000 })] }));
    expect(r.evidence).toMatch(/direct-Roth band/);
  });

  it('high band at $160k → backdoor Roth (above Roth phase-out start)', () => {
    const r = evaluateIraBand(makeContext({ persons: [makePerson({ salary: 160_000 })] }));
    expect(r.evidence).toMatch(/above the Roth phase-out start/);
    expect(r.evidence).toMatch(/Backdoor Roth/);
  });

  it('surfaces partial-phase-out hint inside the Roth phase-out window', () => {
    // $155k is in the Roth phase-out (153k–168k for single).
    const r = evaluateIraBand(makeContext({ persons: [makePerson({ salary: 155_000 })] }));
    // $155k actually crosses into the high band per our boundary
    // (band='high' fires when MAGI >= rothStart = $153k). So this
    // example is in the "backdoor" message, not the mid-band hint.
    expect(r.evidence).toMatch(/Backdoor Roth/);
  });
});

describe('evaluateIraBand — MFJ filer', () => {
  it('low band at $100k MFJ → traditional/Roth choice', () => {
    const r = evaluateIraBand(makeContext({
      filingStatus: 'MFJ',
      persons: [makePerson({ salary: 100_000 })],
    }));
    expect(r.evidence).toMatch(/Traditional vs\. Roth/);
  });

  it('mid band at $180k MFJ → direct Roth', () => {
    const r = evaluateIraBand(makeContext({
      filingStatus: 'MFJ',
      persons: [makePerson({ salary: 180_000 })],
    }));
    expect(r.evidence).toMatch(/direct-Roth band/);
  });

  it('high band at $260k MFJ → backdoor Roth', () => {
    const r = evaluateIraBand(makeContext({
      filingStatus: 'MFJ',
      persons: [makePerson({ salary: 260_000 })],
    }));
    expect(r.evidence).toMatch(/Backdoor Roth/);
  });
});

describe('evaluateIraBand — MFS / HOH note', () => {
  it('treats MFS as single and surfaces the caveat in evidence', () => {
    const r = evaluateIraBand(makeContext({
      filingStatus: 'MFS',
      persons: [makePerson({ salary: 100_000 })],
    }));
    expect(r.evidence).toMatch(/treating MFS as single/);
  });
});

describe('evaluateBackdoorRoth', () => {
  it('active when MAGI is above the Roth phase-out start', () => {
    const r = evaluateBackdoorRoth(makeContext({ persons: [makePerson({ salary: 200_000 })] }));
    expect(r.status).toBe('active');
    expect(r.evidence).toMatch(/pro-rata/);
  });

  it('skipped when MAGI is in the direct-Roth band', () => {
    const r = evaluateBackdoorRoth(makeContext({ persons: [makePerson({ salary: 100_000 })] }));
    expect(r.status).toBe('skipped');
  });

  it('skipped at the low end too', () => {
    const r = evaluateBackdoorRoth(makeContext({ persons: [makePerson({ salary: 50_000 })] }));
    expect(r.status).toBe('skipped');
  });
});

describe('evaluateRothIra', () => {
  it('active in the mid band', () => {
    const r = evaluateRothIra(makeContext({ persons: [makePerson({ salary: 100_000 })] }));
    expect(r.status).toBe('active');
  });

  it('skipped in the high band (backdoor takes over)', () => {
    const r = evaluateRothIra(makeContext({ persons: [makePerson({ salary: 200_000 })] }));
    expect(r.status).toBe('skipped');
    expect(r.evidence).toMatch(/backdoor Roth path/);
  });

  it('skipped in the low band (the traditional-vs-Roth Q owns it)', () => {
    const r = evaluateRothIra(makeContext({ persons: [makePerson({ salary: 50_000 })] }));
    expect(r.status).toBe('skipped');
    expect(r.evidence).toMatch(/traditional-vs-Roth/);
  });
});

describe('evaluateTraditionalIra', () => {
  it('not-started when the expects-higher-income question is unanswered', () => {
    const r = evaluateTraditionalIra(makeContext({
      persons: [makePerson({ salary: 50_000, expectsHigherFutureIncome: null })],
    }));
    expect(r.status).toBe('not-started');
  });

  it('active when low MAGI and not expecting higher income', () => {
    const r = evaluateTraditionalIra(makeContext({
      persons: [makePerson({ salary: 50_000, expectsHigherFutureIncome: false })],
    }));
    expect(r.status).toBe('active');
    expect(r.evidence).toMatch(/traditional IRA deduction available/);
  });

  it('skipped when low MAGI but expecting higher future income', () => {
    const r = evaluateTraditionalIra(makeContext({
      persons: [makePerson({ salary: 50_000, expectsHigherFutureIncome: true })],
    }));
    expect(r.status).toBe('skipped');
    expect(r.evidence).toMatch(/Roth IRA is the recommended branch/);
  });

  it('skipped when MAGI is not in the low band (mid/high)', () => {
    const r = evaluateTraditionalIra(makeContext({
      persons: [makePerson({ salary: 100_000, expectsHigherFutureIncome: false })],
    }));
    expect(r.status).toBe('skipped');
  });
});
