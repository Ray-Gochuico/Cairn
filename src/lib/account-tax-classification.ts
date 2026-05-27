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

/**
 * Fine-grained tax bucket used by the sequential withdrawal strategy. The
 * standard textbook drawdown order is:
 *
 *   1. `taxable` — brokerage and crypto: gains already realized at LTCG
 *      schedule, no additional tax on principal.
 *   2. `taxDeferred` — Traditional 401k/IRA, HSA: full ordinary-income tax
 *      on withdrawal (HSA gets tax-free withdrawal for qualified medical,
 *      but v1 doesn't track usage so we conservatively bucket it as deferred).
 *   3. `roth` — Roth IRA: tax-free withdrawals after 59.5.
 *
 * Note: ACCOUNT_401K is ambiguous (Roth 401k or Traditional). We classify
 * it as `taxDeferred` since the vast majority of 401k balances are Traditional;
 * a future migration can split the type or add a per-account flag.
 *
 * 529 plans are bucketed as `taxDeferred` (qualified education withdrawals
 * are tax-free, but treating as deferred is the safer default for general
 * drawdown; the engine doesn't model 529 → education sequencing).
 */
export type SequencingBucket = 'taxable' | 'taxDeferred' | 'roth';

export function sequencingBucketForAccount(account: Account): SequencingBucket | null {
  switch (account.type) {
    case AccountType.ACCOUNT_CASH:
    case AccountType.ACCOUNT_SAVINGS:
      return null;
    case AccountType.ACCOUNT_BROKERAGE:
    case AccountType.ACCOUNT_CRYPTO:
      return 'taxable';
    case AccountType.ACCOUNT_ROTH_IRA:
      return 'roth';
    case AccountType.ACCOUNT_401K:
    case AccountType.ACCOUNT_TRAD_IRA:
    case AccountType.ACCOUNT_HSA:
    case AccountType.ACCOUNT_529:
      return 'taxDeferred';
    default:
      return null;
  }
}
