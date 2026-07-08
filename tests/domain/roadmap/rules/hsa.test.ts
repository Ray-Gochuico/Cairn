import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  evaluatePickInsurance,
  evaluateHdhpQ,
  evaluateContributeHsa,
  evaluateSaveReceipts,
  evaluateHsaFeesQ,
  evaluateRolloverHsa,
  evaluateKeepEmployerHsa,
} from '@/domain/roadmap/rules/hsa';
import { useHouseholdStore } from '@/stores/household-store';
import { useAccountsStore } from '@/stores/accounts-store';
import type { Account, Contribution } from '@/types/schema';
import type { RoadmapContext } from '@/types/roadmap';
import { AccountType, ContributionSource } from '@/types/enums';
import { makeHousehold } from '../../../factories';


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

function makeContribution(accountId: number, amount: number, date: string): Contribution {
  return {
    id: Math.floor(Math.random() * 1e9),
    accountId,
    personId: 1,
    date,
    amount,
    source: ContributionSource.PAYCHECK,
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

describe('evaluatePickInsurance', () => {
  it('returns info', () => {
    expect(evaluatePickInsurance(makeContext()).status).toBe('info');
  });
});

describe('evaluateHdhpQ', () => {
  beforeEach(() => {
    useHouseholdStore.setState({ update: vi.fn().mockResolvedValue(undefined) } as any);
  });

  it('unanswered with question when null', () => {
    const r = evaluateHdhpQ(makeContext());
    expect(r.status).toBe('unanswered');
    expect(r.question?.answerType).toBe('yes-no');
  });

  it('done when true', () => {
    const r = evaluateHdhpQ(makeContext({ household: makeHousehold({ hasHsaQualifiedHdhp: true }) }));
    expect(r.status).toBe('done');
  });

  it('info when false (chart routes around HSA)', () => {
    const r = evaluateHdhpQ(makeContext({ household: makeHousehold({ hasHsaQualifiedHdhp: false }) }));
    expect(r.status).toBe('info');
    expect(r.evidence).toMatch(/Section 4/);
  });

  it('writes through the store on answer', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    useHouseholdStore.setState({ update } as any);
    const r = evaluateHdhpQ(makeContext());
    await r.question!.onAnswer('no');
    expect(update).toHaveBeenCalledWith({ hasHsaQualifiedHdhp: false });
  });
});

describe('evaluateContributeHsa', () => {
  it('skipped when HDHP is false', () => {
    const r = evaluateContributeHsa(makeContext({ household: makeHousehold({ hasHsaQualifiedHdhp: false }) }));
    expect(r.status).toBe('skipped');
  });

  it('not-started when no HSA account exists', () => {
    const r = evaluateContributeHsa(makeContext({ household: makeHousehold({ hasHsaQualifiedHdhp: true }) }));
    expect(r.status).toBe('not-started');
  });

  it('active when HSA exists but YTD = 0', () => {
    const accts = [makeAccount(7, AccountType.ACCOUNT_HSA, { name: 'Fidelity HSA' })];
    const r = evaluateContributeHsa(makeContext({
      household: makeHousehold({ hasHsaQualifiedHdhp: true }),
      accounts: accts,
    }));
    expect(r.status).toBe('active');
    expect(r.evidence).toMatch(/Fidelity HSA/);
  });

  it('done when YTD > 0', () => {
    const accts = [makeAccount(7, AccountType.ACCOUNT_HSA)];
    const r = evaluateContributeHsa(makeContext({
      household: makeHousehold({ hasHsaQualifiedHdhp: true }),
      accounts: accts,
      contributions: [makeContribution(7, 4000, '2026-02-01')],
    }));
    expect(r.status).toBe('done');
    expect(r.evidence).toMatch(/\$4,000/);
  });

  it('ignores prior-year contributions', () => {
    const accts = [makeAccount(7, AccountType.ACCOUNT_HSA)];
    const r = evaluateContributeHsa(makeContext({
      household: makeHousehold({ hasHsaQualifiedHdhp: true }),
      accounts: accts,
      contributions: [makeContribution(7, 9999, '2025-12-31')],
    }));
    expect(r.status).toBe('active');
  });
});

describe('evaluateSaveReceipts', () => {
  it('returns info', () => {
    expect(evaluateSaveReceipts(makeContext()).status).toBe('info');
  });
});

describe('evaluateHsaFeesQ', () => {
  beforeEach(() => {
    useAccountsStore.setState({ update: vi.fn().mockResolvedValue(undefined) } as any);
  });

  it('skipped when HDHP=false', () => {
    const r = evaluateHsaFeesQ(makeContext({ household: makeHousehold({ hasHsaQualifiedHdhp: false }) }));
    expect(r.status).toBe('skipped');
  });

  it('not-started without an HSA', () => {
    const r = evaluateHsaFeesQ(makeContext({ household: makeHousehold({ hasHsaQualifiedHdhp: true }) }));
    expect(r.status).toBe('not-started');
  });

  it('done with high-fee evidence when hasHighFees=true', () => {
    const accts = [makeAccount(7, AccountType.ACCOUNT_HSA, { hasHighFees: true })];
    const r = evaluateHsaFeesQ(makeContext({
      household: makeHousehold({ hasHsaQualifiedHdhp: true }),
      accounts: accts,
    }));
    expect(r.status).toBe('done');
    expect(r.evidence).toMatch(/rollover/);
  });

  it('done with acceptable-fees evidence when hasHighFees=false', () => {
    const accts = [makeAccount(7, AccountType.ACCOUNT_HSA, { hasHighFees: false })];
    const r = evaluateHsaFeesQ(makeContext({
      household: makeHousehold({ hasHsaQualifiedHdhp: true }),
      accounts: accts,
    }));
    expect(r.status).toBe('done');
    expect(r.evidence).toMatch(/keep contributing/);
  });

  it('unanswered with question when hasHighFees is null', () => {
    const accts = [makeAccount(7, AccountType.ACCOUNT_HSA, { hasHighFees: null })];
    const r = evaluateHsaFeesQ(makeContext({
      household: makeHousehold({ hasHsaQualifiedHdhp: true }),
      accounts: accts,
    }));
    expect(r.status).toBe('unanswered');
  });

  it('writes through the accounts store on answer', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    useAccountsStore.setState({ update } as any);
    const accts = [makeAccount(7, AccountType.ACCOUNT_HSA, { hasHighFees: null })];
    const r = evaluateHsaFeesQ(makeContext({
      household: makeHousehold({ hasHsaQualifiedHdhp: true }),
      accounts: accts,
    }));
    await r.question!.onAnswer('yes');
    expect(update).toHaveBeenCalledWith(7, { hasHighFees: true });
  });
});

describe('evaluateRolloverHsa', () => {
  it('active when high-fee HSA flagged', () => {
    const accts = [makeAccount(7, AccountType.ACCOUNT_HSA, { hasHighFees: true })];
    const r = evaluateRolloverHsa(makeContext({
      household: makeHousehold({ hasHsaQualifiedHdhp: true }),
      accounts: accts,
    }));
    expect(r.status).toBe('active');
  });

  it('skipped when no high-fee HSA', () => {
    const accts = [makeAccount(7, AccountType.ACCOUNT_HSA, { hasHighFees: false })];
    const r = evaluateRolloverHsa(makeContext({
      household: makeHousehold({ hasHsaQualifiedHdhp: true }),
      accounts: accts,
    }));
    expect(r.status).toBe('skipped');
  });
});

describe('evaluateKeepEmployerHsa', () => {
  it('info when low-fee HSA', () => {
    const accts = [makeAccount(7, AccountType.ACCOUNT_HSA, { hasHighFees: false })];
    const r = evaluateKeepEmployerHsa(makeContext({
      household: makeHousehold({ hasHsaQualifiedHdhp: true }),
      accounts: accts,
    }));
    expect(r.status).toBe('info');
  });

  it('skipped when high-fee HSA', () => {
    const accts = [makeAccount(7, AccountType.ACCOUNT_HSA, { hasHighFees: true })];
    const r = evaluateKeepEmployerHsa(makeContext({
      household: makeHousehold({ hasHsaQualifiedHdhp: true }),
      accounts: accts,
    }));
    expect(r.status).toBe('skipped');
  });
});
