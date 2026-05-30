import { describe, it, expect } from 'vitest';
import { sequencingBucketForAccount, taxBucketForAccount } from '@/lib/account-tax-classification';
import type { Account } from '@/types/schema';
import { AccountType } from '@/types/enums';

const acct = (type: string): Account =>
  ({ id: 1, householdId: 1, type, name: 'Test', excludedFromNetWorth: false } as unknown as Account);

describe('taxBucketForAccount', () => {
  it.each([
    [AccountType.ACCOUNT_401K, 'taxAdvantaged'],
    [AccountType.ACCOUNT_ROTH_401K, 'taxAdvantaged'],
    [AccountType.ACCOUNT_ROTH_IRA, 'taxAdvantaged'],
    [AccountType.ACCOUNT_TRAD_IRA, 'taxAdvantaged'],
    [AccountType.ACCOUNT_HSA, 'taxAdvantaged'],
    [AccountType.ACCOUNT_529, 'taxAdvantaged'],
  ])('maps %s to taxAdvantaged', (type, expected) => {
    expect(taxBucketForAccount(acct(type))).toBe(expected);
  });

  it.each([
    [AccountType.ACCOUNT_BROKERAGE, 'taxable'],
    [AccountType.ACCOUNT_CRYPTO, 'taxable'],
  ])('maps %s to taxable', (type, expected) => {
    expect(taxBucketForAccount(acct(type))).toBe(expected);
  });

  it.each([
    [AccountType.ACCOUNT_CASH],
    [AccountType.ACCOUNT_SAVINGS],
  ])('returns null for cash/savings account type %s', (type) => {
    expect(taxBucketForAccount(acct(type))).toBeNull();
  });
});

describe('sequencingBucketForAccount', () => {
  it.each([
    [AccountType.ACCOUNT_BROKERAGE, 'taxable'],
    [AccountType.ACCOUNT_CRYPTO, 'taxable'],
  ])('maps %s to taxable', (type, expected) => {
    expect(sequencingBucketForAccount(acct(type))).toBe(expected);
  });

  it('maps Roth IRA to roth', () => {
    expect(sequencingBucketForAccount(acct(AccountType.ACCOUNT_ROTH_IRA))).toBe('roth');
  });

  it('maps Roth 401k to roth (tax-free drawdown, same tier as Roth IRA)', () => {
    expect(sequencingBucketForAccount(acct(AccountType.ACCOUNT_ROTH_401K))).toBe('roth');
  });

  it('keeps Traditional 401k on taxDeferred (Roth-401k addition must not move it)', () => {
    expect(sequencingBucketForAccount(acct(AccountType.ACCOUNT_401K))).toBe('taxDeferred');
  });

  it.each([
    [AccountType.ACCOUNT_401K],
    [AccountType.ACCOUNT_TRAD_IRA],
    [AccountType.ACCOUNT_HSA],
    [AccountType.ACCOUNT_529],
  ])('maps %s to taxDeferred', (type) => {
    expect(sequencingBucketForAccount(acct(type))).toBe('taxDeferred');
  });

  it.each([
    [AccountType.ACCOUNT_CASH],
    [AccountType.ACCOUNT_SAVINGS],
  ])('returns null for non-investment account type %s', (type) => {
    expect(sequencingBucketForAccount(acct(type))).toBeNull();
  });

  // Guards the drawdown engine: every AccountType must reach an explicit case,
  // never the assertNever default. If a future type is added without handling,
  // this throws here (and `tsc` reds at the switch) instead of the account being
  // silently dropped from sequential withdrawals.
  it('classifies every AccountType without hitting the exhaustiveness guard', () => {
    for (const type of Object.values(AccountType)) {
      expect(() => sequencingBucketForAccount(acct(type))).not.toThrow();
    }
  });
});
