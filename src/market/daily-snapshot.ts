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
 * — one bad ticker should not block the rest of the portfolio from
 * receiving its daily snapshot. The caller (Task 4 IIFE wrapper) decides
 * what to log.
 *
 * Returns counts so the caller can surface "n accounts snapshotted, m
 * skipped, k errors" to the user / dev console.
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
  const errors: string[] = [];

  for (const account of allAccounts) {
    if (account.id == null) continue;
    const accountHoldings = holdingsByAccount.get(account.id) ?? [];
    if (accountHoldings.length === 0) {
      skipped.push(account.id);
      continue;
    }

    let totalValue = 0;
    for (const h of accountHoldings) {
      try {
        const price = await deps.prices.currentPrice(h.ticker);
        totalValue += h.shareCount * price;
      } catch (e) {
        errors.push(
          `${account.id}/${h.ticker}: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }

    await deps.snapshots.upsert({
      accountId: account.id,
      snapshotDate: todayIso,
      totalValue,
      source: SnapshotSource.AUTO_DERIVED,
    });
    upserted.push(account.id);
  }

  return { upserted, skipped, errors };
}
