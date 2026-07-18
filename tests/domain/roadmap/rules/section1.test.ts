import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  evaluateIps,
  evaluateNonEssentials,
  evaluateTrackExpenses,
  evaluateEmployerMatchQ,
  evaluateEmployerMatch,
  evaluateJobStability,
} from '@/domain/roadmap/rules/section1';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useAccountsStore } from '@/stores/accounts-store';
import type {
  Account,
  Contribution,
  Household,
  Person,
  Transaction,
} from '@/types/schema';
import type { RoadmapContext } from '@/types/roadmap';
import {
  AccountType,
  ContributionSource,
  FilingStatus,
} from '@/types/enums';
import { makeHousehold } from '../../../factories';


function makePerson(patch: Partial<Person> = {}): Person {
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
    jobStability: null,
    expectsHigherFutureIncome: null,
    onParentHealthInsurance: null,
    isRelativelyHealthy: null,
    ...patch,
  };
}

function makeAccount(id: number, type: AccountType, patch: Partial<Account> = {}): Account {
  return {
    id,
    householdId: 1,
    ownerPersonId: 1,
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

function makeContribution(patch: Partial<Contribution> & { accountId: number; amount: number; date: string }): Contribution {
  return {
    id: Math.floor(Math.random() * 1e9),
    accountId: patch.accountId,
    personId: 1,
    date: patch.date,
    amount: patch.amount,
    source: patch.source ?? ContributionSource.PAYCHECK,
  };
}

function makeTransaction(date: string): Transaction {
  return {
    id: Math.floor(Math.random() * 1e9),
    householdId: 1,
    date,
    merchant: 'Coffee',
    merchantRaw: null,
    amount: 5,
    categoryId: null,
    sourceAccountId: null,
    propertyId: null,
    vehicleId: null,
    personId: null,
    sourcePdfFilename: null,
    reimbursable: false,
    reimbursedAt: null,
    reimbursedAmount: null,
    isRecurring: false,
    notes: null,
  };
}

function makeContext(patch: Partial<RoadmapContext> = {}): RoadmapContext {
  return {
    household: makeHousehold(),
    persons: [],
    accounts: [],
    loans: [],
    contributions: [],
    snapshots: [],
    transactions: [],
    overrides: new Map(),
    thresholds: { low: 5, high: 8 },
    taxYear: 2026,
    today: new Date('2026-05-23T00:00:00Z'),
    ...patch,
  };
}

describe('evaluateIps', () => {
  beforeEach(() => {
    useHouseholdStore.setState({ update: vi.fn().mockResolvedValue(undefined) } as any);
  });

  it('unanswered with a question when hasWrittenIps is null', () => {
    const r = evaluateIps(makeContext({ household: makeHousehold({ hasWrittenIps: null }) }));
    expect(r.status).toBe('unanswered');
    expect(r.question?.answerType).toBe('yes-no');
  });

  it('done when hasWrittenIps is true', () => {
    const r = evaluateIps(makeContext({ household: makeHousehold({ hasWrittenIps: true }) }));
    expect(r.status).toBe('done');
  });

  it('info when hasWrittenIps is false (optional, not required)', () => {
    const r = evaluateIps(makeContext({ household: makeHousehold({ hasWrittenIps: false }) }));
    expect(r.status).toBe('info');
  });

  it('writes through the household store on yes', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    useHouseholdStore.setState({ update } as any);
    const r = evaluateIps(makeContext({ household: makeHousehold({ hasWrittenIps: null }) }));
    await r.question!.onAnswer('yes');
    expect(update).toHaveBeenCalledWith({ hasWrittenIps: true });
  });
});

describe('evaluateNonEssentials', () => {
  it('returns info', () => {
    expect(evaluateNonEssentials(makeContext()).status).toBe('info');
  });
});

describe('evaluateTrackExpenses', () => {
  it('active with CTA when there are no transactions', () => {
    const r = evaluateTrackExpenses(makeContext());
    expect(r.status).toBe('active');
    expect(r.cta?.href).toBe('/spending');
  });

  it('done when a transaction landed inside the 30-day window', () => {
    const r = evaluateTrackExpenses(makeContext({
      transactions: [makeTransaction('2026-05-10')],
    }));
    expect(r.status).toBe('done');
    expect(r.evidence).toMatch(/1 transactions/);
  });

  it('ignores transactions older than 30 days from ctx.today', () => {
    // ctx.today is 2026-05-23 → 30 days back = 2026-04-23.
    const r = evaluateTrackExpenses(makeContext({
      transactions: [makeTransaction('2026-03-01')],
    }));
    expect(r.status).toBe('active');
  });

  it('counts multiple recent transactions', () => {
    const r = evaluateTrackExpenses(makeContext({
      transactions: [
        makeTransaction('2026-05-01'),
        makeTransaction('2026-05-15'),
        makeTransaction('2026-05-20'),
      ],
    }));
    expect(r.status).toBe('done');
    expect(r.evidence).toMatch(/3 transactions/);
  });
});

describe('evaluateEmployerMatchQ', () => {
  it('info when no retirement accounts on file', () => {
    const r = evaluateEmployerMatchQ(makeContext({ accounts: [] }));
    expect(r.status).toBe('info');
    expect(r.evidence).toMatch(/No retirement accounts/);
  });

  it('done when at least one retirement account has hasEmployerMatch=true', () => {
    const accts = [makeAccount(1, AccountType.ACCOUNT_401K, { hasEmployerMatch: true })];
    const r = evaluateEmployerMatchQ(makeContext({ accounts: accts }));
    expect(r.status).toBe('done');
  });

  it('unanswered when any retirement account has hasEmployerMatch null', () => {
    const accts = [
      makeAccount(1, AccountType.ACCOUNT_401K, { hasEmployerMatch: false }),
      makeAccount(2, AccountType.ACCOUNT_TRAD_IRA, { hasEmployerMatch: null }),
    ];
    const r = evaluateEmployerMatchQ(makeContext({ accounts: accts }));
    expect(r.status).toBe('unanswered');
  });

  it('info when all retirement accounts answered false', () => {
    const accts = [makeAccount(1, AccountType.ACCOUNT_401K, { hasEmployerMatch: false })];
    const r = evaluateEmployerMatchQ(makeContext({ accounts: accts }));
    expect(r.status).toBe('info');
    expect(r.evidence).toMatch(/No employer match/);
  });

  it('asks the employer-match question inline when exactly one 401(k) is unanswered, and writes the flag (W10 M24)', async () => {
    const ctx = makeContext({
      accounts: [makeAccount(9, AccountType.ACCOUNT_401K, { name: 'Acme 401(k)', hasEmployerMatch: null })],
    });
    const result = evaluateEmployerMatchQ(ctx);
    expect(result.status).toBe('unanswered');
    expect(result.question?.prompt).toMatch(/Acme 401\(k\).*match/i);
    const update = vi.fn(async () => {});
    useAccountsStore.setState({ update } as never);
    await result.question!.onAnswer('yes');
    expect(update).toHaveBeenCalledWith(9, { hasEmployerMatch: true });
  });

  it('falls back to the Accounts CTA when several accounts are unanswered (W10 M24)', () => {
    const ctx = makeContext({
      accounts: [
        makeAccount(1, AccountType.ACCOUNT_401K, { hasEmployerMatch: null }),
        makeAccount(2, AccountType.ACCOUNT_401K, { hasEmployerMatch: null }),
      ],
    });
    const result = evaluateEmployerMatchQ(ctx);
    expect(result.question).toBeUndefined();
    expect(result.cta?.href).toBe('/investments?manage=accounts');
  });
});

describe('evaluateEmployerMatch', () => {
  it('not-started when no account has an employer match', () => {
    const accts = [makeAccount(1, AccountType.ACCOUNT_BROKERAGE, { hasEmployerMatch: false })];
    const r = evaluateEmployerMatch(makeContext({ accounts: accts }));
    expect(r.status).toBe('not-started');
  });

  it('unanswered when a retirement account has hasEmployerMatch null', () => {
    const accts = [makeAccount(1, AccountType.ACCOUNT_401K, { hasEmployerMatch: null })];
    const r = evaluateEmployerMatch(makeContext({ accounts: accts }));
    expect(r.status).toBe('unanswered');
  });

  it('unanswered when account has match flag but no employerMatchLimitPct', () => {
    const accts = [makeAccount(1, AccountType.ACCOUNT_401K, {
      hasEmployerMatch: true,
      employerMatchLimitPct: null,
    })];
    const ctx = makeContext({ accounts: accts, persons: [makePerson({ annualSalaryPretax: 100_000 })] });
    const r = evaluateEmployerMatch(ctx);
    expect(r.status).toBe('unanswered');
    expect(r.evidence).toMatch(/match-limit-pct/);
  });

  it('active when YTD contributions fall short of the salary × limit target', () => {
    const accts = [makeAccount(1, AccountType.ACCOUNT_401K, {
      hasEmployerMatch: true,
      employerMatchLimitPct: 0.05, // need 5% of salary to capture full match
    })];
    const ctx = makeContext({
      accounts: accts,
      persons: [makePerson({ id: 1, annualSalaryPretax: 100_000 })],
      contributions: [makeContribution({ accountId: 1, amount: 2_000, date: '2026-03-01' })],
    });
    const r = evaluateEmployerMatch(ctx);
    expect(r.status).toBe('active');
    expect(r.evidence).toMatch(/\$2,000/);
    expect(r.evidence).toMatch(/\$5,000/);
  });

  it('done when YTD contributions meet the target', () => {
    const accts = [makeAccount(1, AccountType.ACCOUNT_401K, {
      hasEmployerMatch: true,
      employerMatchLimitPct: 0.05,
    })];
    const ctx = makeContext({
      accounts: accts,
      persons: [makePerson({ id: 1, annualSalaryPretax: 100_000 })],
      contributions: [makeContribution({ accountId: 1, amount: 5_000, date: '2026-03-01' })],
    });
    const r = evaluateEmployerMatch(ctx);
    expect(r.status).toBe('done');
  });

  it('ignores contributions from prior calendar years', () => {
    const accts = [makeAccount(1, AccountType.ACCOUNT_401K, {
      hasEmployerMatch: true,
      employerMatchLimitPct: 0.05,
    })];
    const ctx = makeContext({
      accounts: accts,
      persons: [makePerson({ id: 1, annualSalaryPretax: 100_000 })],
      contributions: [makeContribution({ accountId: 1, amount: 50_000, date: '2025-12-31' })],
    });
    const r = evaluateEmployerMatch(ctx);
    expect(r.status).toBe('active');
  });
});

describe('evaluateJobStability', () => {
  beforeEach(() => {
    usePersonsStore.setState({ update: vi.fn().mockResolvedValue(undefined) } as any);
  });

  it('info when no persons are on file', () => {
    const r = evaluateJobStability(makeContext());
    expect(r.status).toBe('info');
  });

  it('unanswered with question when any person has jobStability null', () => {
    const r = evaluateJobStability(makeContext({ persons: [makePerson({ jobStability: null })] }));
    expect(r.status).toBe('unanswered');
    expect(r.question?.answerType).toBe('enum');
  });

  it('done with stable-path evidence when everyone is stable', () => {
    const r = evaluateJobStability(makeContext({ persons: [makePerson({ jobStability: 'stable' })] }));
    expect(r.status).toBe('done');
    expect(r.evidence).toMatch(/3-month EF target/);
  });

  it('done with unstable-path evidence when anyone is unstable', () => {
    const r = evaluateJobStability(makeContext({
      persons: [
        makePerson({ jobStability: 'stable' }),
        makePerson({ id: 2, jobStability: 'unstable' }),
      ],
    }));
    expect(r.status).toBe('done');
    expect(r.evidence).toMatch(/6–12-month EF target/);
  });

  it('writes through the persons store on answer', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    usePersonsStore.setState({ update } as any);
    const r = evaluateJobStability(makeContext({ persons: [makePerson({ id: 7 })] }));
    await r.question!.onAnswer('stable');
    expect(update).toHaveBeenCalledWith(7, { jobStability: 'stable' });
  });
});
