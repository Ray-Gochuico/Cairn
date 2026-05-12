import type { AccountsRepo } from '@/domain/accounts';
import type { HoldingsRepo } from '@/domain/holdings';
import type { AccountSnapshotsRepo } from '@/domain/snapshots';
import { AccountType, SnapshotSource } from '@/types/enums';
import { lastBusinessDayOfMonth, monthsBetween } from '@/lib/business-days';
import type { PriceCacheAPI } from './price-cache';

export interface SnapshotDerivationDeps {
  accounts: AccountsRepo;
  holdings: HoldingsRepo;
  snapshots: AccountSnapshotsRepo;
  prices: PriceCacheAPI;
}

/**
 * Account types whose snapshot values must be entered manually rather
 * than derived from ticker prices.
 *   - CASH / SAVINGS: cash balances aren't securities; users update them
 *     in the monthly mini-window.
 *   - CRYPTO: wallet auto-fetch is Phase 3; Phase 2 treats crypto as
 *     manually entered.
 */
const SKIPPED_ACCOUNT_TYPES = new Set<AccountType>([
  AccountType.ACCOUNT_CASH,
  AccountType.ACCOUNT_SAVINGS,
  AccountType.ACCOUNT_CRYPTO,
]);

/**
 * Derive an AUTO_DERIVED snapshot for each non-cash, non-excluded account
 * for the given month. Snapshot date is the last business day of `yyyymm`.
 */
export async function deriveSnapshotsForMonth(
  yyyymm: string,
  deps: SnapshotDerivationDeps
): Promise<void> {
  const snapshotDate = lastBusinessDayOfMonth(yyyymm);
  const allAccounts = await deps.accounts.list();

  for (const account of allAccounts) {
    if (SKIPPED_ACCOUNT_TYPES.has(account.type)) continue;
    if (account.excludedFromNetWorth) continue;
    if (account.id == null) continue;

    const accountHoldings = await deps.holdings.listForAccount(account.id);
    if (accountHoldings.length === 0) continue;

    let totalValue = 0;
    for (const h of accountHoldings) {
      const price = await deps.prices.historicalPrice(h.ticker, snapshotDate);
      totalValue += h.shareCount * price;
    }

    await deps.snapshots.upsert({
      accountId: account.id,
      snapshotDate,
      totalValue,
      source: SnapshotSource.AUTO_DERIVED,
    });
  }
}

/**
 * Derive monthly snapshots for the last 12 months ending in `now`.
 * Range is inclusive on both ends so the call covers a rolling year of
 * history. Per-month errors (e.g. an unknown ticker) are logged and
 * swallowed so one bad input does not break the entire batch.
 */
export async function deriveLast12Months(
  deps: SnapshotDerivationDeps,
  now: Date = new Date()
): Promise<void> {
  const fromYear = now.getUTCFullYear();
  const fromMonth = now.getUTCMonth() + 1; // JS months are 0-indexed; YYYY-MM is 1-indexed
  const toYyyymm = `${fromYear.toString().padStart(4, '0')}-${fromMonth.toString().padStart(2, '0')}`;

  // Walk back 12 months for the "from" boundary.
  const fromDate = new Date(Date.UTC(fromYear, fromMonth - 1 - 12, 1));
  const fromYyyymm = `${fromDate
    .getUTCFullYear()
    .toString()
    .padStart(4, '0')}-${(fromDate.getUTCMonth() + 1).toString().padStart(2, '0')}`;

  const months = monthsBetween(fromYyyymm, toYyyymm);

  for (const month of months) {
    try {
      await deriveSnapshotsForMonth(month, deps);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[snapshot-derivation] failed for ${month}:`, err);
    }
  }
}
