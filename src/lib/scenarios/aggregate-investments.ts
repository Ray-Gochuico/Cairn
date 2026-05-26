import type { Account } from '@/types/schema';
import type { MonthlyState } from './engine';
import { taxBucketForAccount, type TaxBucket } from '@/lib/account-tax-classification';

/**
 * Sum all per-account investment balances in a MonthlyState.
 * Used for the 'single' detail-level view.
 */
export function totalInvestments(state: MonthlyState): number {
  return Object.values(state.investmentsByAccount).reduce((sum, v) => sum + v, 0);
}

/**
 * Aggregate per-account balances into tax-bucket totals.
 * Account IDs present in `state.investmentsByAccount` but absent from
 * `accounts` are silently excluded — they might be stale deleted accounts.
 * Cash/savings accounts return null from `taxBucketForAccount` and are
 * likewise excluded (they live in `state.cash`, not `investmentsByAccount`).
 */
export function aggregateByTaxBucket(
  state: MonthlyState,
  accounts: Account[],
): Record<TaxBucket, number> {
  const result: Record<TaxBucket, number> = { taxAdvantaged: 0, taxable: 0 };
  const accountById = new Map<number, Account>(
    accounts.filter((a) => a.id != null).map((a) => [a.id!, a]),
  );
  for (const [idStr, balance] of Object.entries(state.investmentsByAccount)) {
    const id = Number(idStr);
    const account = accountById.get(id);
    if (!account) continue;
    const bucket = taxBucketForAccount(account);
    if (!bucket) continue;
    result[bucket] += balance;
  }
  return result;
}
