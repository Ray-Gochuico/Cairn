import type { AccountsRepo } from '@/domain/accounts';
import type { HoldingsRepo } from '@/domain/holdings';
import type { AccountSnapshotsRepo } from '@/domain/snapshots';
import type { Holding } from '@/types/schema';
import { SnapshotSource } from '@/types/enums';
import type { PriceCacheAPI } from './price-cache';

export interface DailySnapshotDeps {
  accounts: AccountsRepo;
  holdings: HoldingsRepo;
  snapshots: AccountSnapshotsRepo;
  prices: PriceCacheAPI;
}

export interface DailySnapshotResult {
  /** Account ids that received a snapshot row today. */
  upserted: number[];
  /** Account ids skipped because they had no holdings to value. */
  skipped: number[];
  /**
   * Account ids that had holdings but at least one of them failed to price
   * (offline / Yahoo 429 / delisted). NO snapshot is written for these — a
   * partial sum would under-count net worth and, written as AUTO_DERIVED,
   * become the latest authoritative value driving the Dashboard tile + the
   * net-worth chart. The prior (clean) snapshot, if any, is left untouched.
   * The specific ticker failures are also in `errors`.
   */
  partial: number[];
  /** Per-ticker error strings ("<accountId>/<ticker>: <message>"). Non-fatal. */
  errors: string[];
}

/**
 * For each account with at least one holding, compute today's total value
 * (Σ shares × currentPrice) and upsert one row into account_snapshots
 * keyed by (account_id, snapshot_date). The UNIQUE constraint on that
 * pair makes a re-run the same day idempotent.
 *
 * Per-ticker price errors are collected into `errors` rather than thrown
 * — one bad ticker should not block the REST of the portfolio (other
 * accounts) from receiving its daily snapshot. The caller (Task 4 IIFE
 * wrapper) decides what to log.
 *
 * BUT a price failure WITHIN an account is not swallowed into that account's
 * total: summing only the holdings that priced would record a confidently
 * too-low net-worth number. So if ANY of an account's holdings fail to
 * price, that account is routed to `partial` and NO snapshot is written for
 * it (its prior clean snapshot, if any, stays the latest value) — never an
 * under-counted AUTO_DERIVED row.
 *
 * Returns counts so the caller can surface "n accounts snapshotted, m
 * skipped, p partial (price failures, held back), k errors" to the user /
 * dev console.
 */
export async function deriveTodaysSnapshot(
  deps: DailySnapshotDeps,
  today: Date = new Date()
): Promise<DailySnapshotResult> {
  const todayIso = today.toISOString().slice(0, 10);
  const allAccounts = await deps.accounts.list();
  const allHoldings = await deps.holdings.listAll();

  const holdingsByAccount = new Map<number, Holding[]>();
  for (const h of allHoldings) {
    const list = holdingsByAccount.get(h.accountId) ?? [];
    list.push(h);
    holdingsByAccount.set(h.accountId, list);
  }

  const upserted: number[] = [];
  const skipped: number[] = [];
  const partial: number[] = [];
  const errors: string[] = [];

  for (const account of allAccounts) {
    if (account.id == null) continue;
    const accountHoldings = holdingsByAccount.get(account.id) ?? [];
    if (accountHoldings.length === 0) {
      skipped.push(account.id);
      continue;
    }

    let totalValue = 0;
    let failed = false;
    for (const h of accountHoldings) {
      try {
        const price = await deps.prices.currentPrice(h.ticker);
        totalValue += h.shareCount * price;
      } catch (e) {
        failed = true;
        errors.push(
          `${account.id}/${h.ticker}: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }

    // Any holding that failed to price makes `totalValue` an under-count of
    // this account's true value. Writing it as the latest AUTO_DERIVED
    // snapshot would corrupt the Dashboard net-worth tile + chart with a
    // confidently-wrong low number, so hold the account back instead. The
    // failure is already in `errors` for the "Refresh now" UI to surface;
    // the prior clean snapshot (if any) remains the latest value.
    if (failed) {
      partial.push(account.id);
      continue;
    }

    await deps.snapshots.upsert({
      accountId: account.id,
      snapshotDate: todayIso,
      totalValue,
      source: SnapshotSource.AUTO_DERIVED,
    });
    upserted.push(account.id);
  }

  return { upserted, skipped, partial, errors };
}
