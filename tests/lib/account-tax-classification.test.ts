import { describe, it, expect } from 'vitest';
import { taxBucketForAccount } from '@/lib/account-tax-classification';
import type { Account } from '@/types/schema';
import { AccountType } from '@/types/enums';

const acct = (type: string): Account =>
  ({ id: 1, householdId: 1, type, name: 'Test', excludedFromNetWorth: false } as unknown as Account);

describe('taxBucketForAccount', () => {
  it.each([
    [AccountType.ACCOUNT_401K, 'taxAdvantaged'],
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
