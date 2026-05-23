import type { Database } from '@/db/db';
import { AccountsRepo } from '@/domain/accounts';
import { HoldingsRepo } from '@/domain/holdings';
import { AccountSnapshotsRepo } from '@/domain/snapshots';
import { FundHoldingsRepo } from '@/domain/fund-holdings';
import { TickersRepo } from '@/domain/tickers';
import { PriceCache } from '@/market/price-cache';
import { YahooClient } from '@/market/yahoo-client';
import { deriveLast12Months } from '@/market/snapshot-derivation';
import { deriveTodaysSnapshot } from '@/market/daily-snapshot';
import { syncStaleFunds } from '@/market/fund-holdings-sync';

/**
 * Run the three background market-data derivations — the 12-month snapshot
 * backfill, the stale fund-holdings sync, and today's per-account snapshot.
 *
 * Extracted from `init.ts` so both launch (`init.ts`, gated by
 * `isRefreshDue`) and the Settings "Refresh now" button call one
 * implementation. Each derivation runs in its own fire-and-forget IIFE that
 * swallows its own errors: a Yahoo failure in one branch must not block the
 * others, and none of them may crash startup. This function returns
 * immediately — it does NOT await the IIFEs — so the UI mounts without
 * waiting on the network.
 */
export function runMarketDataRefresh(db: Database): void {
  // Kick off snapshot derivation in the background so the UI mounts
  // immediately. Yahoo unreachable on first boot must not crash startup —
  // any failure inside is logged and swallowed.
  void (async () => {
    try {
      const accounts = new AccountsRepo(db);
      const holdings = new HoldingsRepo(db);
      const snapshots = new AccountSnapshotsRepo(db);
      const prices = new PriceCache(db, new YahooClient());
      await deriveLast12Months({ accounts, holdings, snapshots, prices });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[market] background snapshot derivation failed:', err);
    }
  })();

  // Refresh stale fund-of-funds holdings so the Concentration look-through
  // sees up-to-date weights. Independent of snapshot derivation — kept in
  // its own IIFE so a Yahoo failure in either branch doesn't block the
  // other, and a partial-fail still leaves the UI responsive.
  void (async () => {
    try {
      const result = await syncStaleFunds({
        yahoo: new YahooClient(),
        fundHoldings: new FundHoldingsRepo(db),
        tickers: new TickersRepo(db),
        holdings: new HoldingsRepo(db),
      });
      // Surface the sync outcome so DevTools shows exactly which tickers
      // got refreshed, which were skipped (already-fresh OR Yahoo returned
      // no holdings), and which errored. Helps diagnose the "fund ticker
      // shows up on Per-Company donut instead of underlying companies"
      // bug when Yahoo returns empty for VTI/FXAIX etc.
      // eslint-disable-next-line no-console
      console.info(
        '[market] fund-holdings sync done: refreshed=%o skipped=%o errors=%o',
        result.refreshed,
        result.skipped,
        result.errors,
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[market] background fund-holdings sync failed:', err);
    }
  })();

  // Derive today's per-account snapshot so the dashboard shows current
  // totals immediately after boot. Independent of the 12-month backfill
  // and fund sync — kept in its own IIFE so a failure in either doesn't
  // block this, and vice versa.
  void (async () => {
    try {
      const accounts = new AccountsRepo(db);
      const holdings = new HoldingsRepo(db);
      const snapshots = new AccountSnapshotsRepo(db);
      const prices = new PriceCache(db, new YahooClient());
      const result = await deriveTodaysSnapshot({ accounts, holdings, snapshots, prices });
      // eslint-disable-next-line no-console
      console.info(
        '[market] daily snapshot done: upserted=%o skipped=%o errors=%o',
        result.upserted, result.skipped, result.errors,
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[market] daily snapshot derivation failed:', err);
    }
  })();
}
