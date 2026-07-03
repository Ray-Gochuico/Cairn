import { describe, it, expect } from 'vitest';
import { fiEligibleAccountIds, fiEligiblePortfolioValue } from '@/lib/fi-portfolio';
import { AccountType } from '@/types/enums';
import type { Account } from '@/types/schema';

function acct(id: number, type: AccountType, excluded = false): Account {
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
    excludedFromNetWorth: excluded,
    stateOfPlan: null,
    accentColor: null,
  } as unknown as Account;
}

function snap(accountId: number, snapshotDate: string, totalValue: number) {
  return { accountId, snapshotDate, totalValue };
}

const TODAY = '2026-07-02';

describe('fiEligibleAccountIds', () => {
  it('keeps investments, cash, savings, HSA, crypto; drops 529 and excluded', () => {
    const accounts = [
      acct(1, AccountType.ACCOUNT_BROKERAGE),
      acct(2, AccountType.ACCOUNT_CASH),
      acct(3, AccountType.ACCOUNT_SAVINGS),
      acct(4, AccountType.ACCOUNT_HSA),
      acct(5, AccountType.ACCOUNT_CRYPTO),
      acct(6, AccountType.ACCOUNT_529),                 // education-earmarked → out
      acct(7, AccountType.ACCOUNT_401K, true),          // excludedFromNetWorth → out
      acct(8, AccountType.ACCOUNT_ROTH_IRA),
    ];
    expect(fiEligibleAccountIds(accounts)).toEqual(new Set([1, 2, 3, 4, 5, 8]));
  });

  it('skips accounts without a persisted id', () => {
    const noId = { ...acct(1, AccountType.ACCOUNT_BROKERAGE), id: undefined } as unknown as Account;
    expect(fiEligibleAccountIds([noId])).toEqual(new Set());
  });
});

describe('fiEligiblePortfolioValue', () => {
  const accounts = [
    acct(1, AccountType.ACCOUNT_BROKERAGE),
    acct(2, AccountType.ACCOUNT_529),
    acct(3, AccountType.ACCOUNT_401K, true),
    acct(4, AccountType.ACCOUNT_SAVINGS),
  ];

  it('sums the latest snapshot per eligible account; 529 + excluded never inflate it', () => {
    const snapshots = [
      snap(1, '2026-06-01', 90_000),
      snap(1, '2026-06-20', 100_000), // latest wins
      snap(2, '2026-06-20', 50_000),  // 529 — ignored
      snap(3, '2026-06-20', 25_000),  // excluded — ignored
      snap(4, '2026-06-20', 10_000),
    ];
    expect(fiEligiblePortfolioValue(accounts, snapshots, TODAY)).toBe(110_000);
  });

  it('applies the snapshotDate <= today cutoff', () => {
    const snapshots = [snap(1, '2026-06-01', 90_000), snap(1, '2026-08-01', 999_999)];
    expect(fiEligiblePortfolioValue(accounts, snapshots, TODAY)).toBe(90_000);
  });

  it('returns 0 when no eligible account has history (never null — these are form defaults)', () => {
    expect(fiEligiblePortfolioValue(accounts, [snap(2, '2026-06-01', 50_000)], TODAY)).toBe(0);
    expect(fiEligiblePortfolioValue([], [], TODAY)).toBe(0);
  });
});
