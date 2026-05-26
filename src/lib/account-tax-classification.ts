import type { Account } from '@/types/schema';
import { AccountType } from '@/types/enums';

export type TaxBucket = 'taxAdvantaged' | 'taxable';

const TAX_ADVANTAGED_TYPES: ReadonlySet<string> = new Set([
  AccountType.ACCOUNT_401K,
  AccountType.ACCOUNT_ROTH_IRA,
  AccountType.ACCOUNT_TRAD_IRA,
  AccountType.ACCOUNT_HSA,
  AccountType.ACCOUNT_529,
]);

/**
 * Returns which tax bucket an account belongs to, or null if the account is
 * a cash/savings account (those flow into MonthlyState.cash, not investments).
 */
export function taxBucketForAccount(account: Account): TaxBucket | null {
  if (
    account.type === AccountType.ACCOUNT_CASH ||
    account.type === AccountType.ACCOUNT_SAVINGS
  ) {
    return null;
  }
  return TAX_ADVANTAGED_TYPES.has(account.type) ? 'taxAdvantaged' : 'taxable';
}
