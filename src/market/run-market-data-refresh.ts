import type { Database } from '@/db/db';
import { AccountsRepo } from '@/domain/accounts';
import { HoldingsRepo } from '@/domain/holdings';
import { AccountSnapshotsRepo } from '@/domain/snapshots';
import { FundHoldingsRepo } from '@/domain/fund-holdings';
import { FundSectorsRepo } from '@/domain/fund-sectors';
import { TickersRepo } from '@/domain/tickers';
import { PriceCache } from '@/market/price-cache';
import { YahooClient } from '@/market/yahoo-client';
import { deriveTodaysSnapshot, type DailySnapshotResult } from '@/market/daily-snapshot';
import { syncStaleFunds, type SyncResult } from '@/market/fund-holdings-sync';
import { enrichTickerIfMissing, updateTicker52Week } from '@/market/ticker-enrichment';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useFundHoldingsStore } from '@/stores/fund-holdings-store';
import { useFundSectorsStore } from '@/stores/fund-sectors-store';
import { useTickersStore } from '@/stores/tickers-store';

/** One branch's outcome: its result, or the error it swallowed (W19). */
export type RefreshBranchOutcome<T> =
  | { status: 'ok'; result: T }
  | { status: 'error'; error: string };

/**
 * Aggregate outcome of the three refresh branches (W19). Callers that care
 * (Settings "Refresh now", the freshness-badge popover) await it and report;
 * the launch path keeps ignoring it.
 */
export interface MarketDataRefreshResult {
  fundSync: RefreshBranchOutcome<SyncResult>;
  enrichment: RefreshBranchOutcome<{ enriched: number }>;
  snapshot: RefreshBranchOutcome<DailySnapshotResult>;
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Run the three background market-data derivations — the stale fund-holdings
 * sync, the per-ticker sector/industry enrichment, and today's per-account
 * snapshot.
 *
 * Extracted from `init.ts` so launch (`init.ts`, gated by `isRefreshDue`),
 * the Settings "Refresh now" button, the freshness-badge popover, and the
 * fetch-on-add path call one implementation. The three branches start
 * concurrently and each swallows its own errors: a Yahoo failure in one
 * branch must not block the others, and none of them may crash startup.
 * The function returns synchronously with a promise — it does NOT block on
 * the network before returning — so the UI mounts without waiting.
 *
 * W19 contract: the returned promise resolves once ALL THREE branches have
 * settled, with each branch's result or swallowed error, and it NEVER
 * rejects — init.ts keeps calling it fire-and-forget (`void run…`), while
 * RefreshSection awaits it to stamp lastRefreshAt honestly and surface
 * unpriceable tickers instead of resolving on the next microtask.
 *
 * On a successful daily-snapshot derivation with upserted rows, the
 * snapshots store is reloaded so mounted dashboards refeed (same for the
 * fund stores and the tickers store on their branches).
 */
export function runMarketDataRefresh(db: Database): Promise<MarketDataRefreshResult> {
  // Refresh stale fund-of-funds holdings so the Concentration look-through
  // sees up-to-date weights. Independent of snapshot derivation — its own
  // branch so a Yahoo failure in either doesn't block the other, and a
  // partial-fail still leaves the UI responsive.
  const fundSyncPromise = (async (): Promise<RefreshBranchOutcome<SyncResult>> => {
    try {
      const result = await syncStaleFunds({
        yahoo: new YahooClient(),
        fundHoldings: new FundHoldingsRepo(db),
        fundSectors: new FundSectorsRepo(db),
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
      // Refeed mounted surfaces (round-2 C2, same convention as the
      // daily-snapshot branch below): syncStaleFunds writes fund_holdings AND
      // fund_sectors, so a successful refresh reloads both stores — the
      // manual Data-health path already did (DataHealthPopover). Only when
      // rows actually changed; load() de-dupes and swallows its own errors.
      if (result.refreshed.length > 0) {
        void useFundHoldingsStore.getState().load();
        void useFundSectorsStore.getState().load();
      }
      return { status: 'ok', result };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[market] background fund-holdings sync failed:', err);
      return { status: 'error', error: toErrorMessage(err) };
    }
  })();

  // Lazy backfill of sector/industry for each distinct held ticker.
  // `enrichTickerIfMissing` early-exits when the ticker already has a
  // non-null sector, so this is cheap for already-enriched tickers and
  // only hits Yahoo for the ones that pre-date migration 0016 (or whose
  // previous attempt returned null). Without this loop, tickers added
  // before the industry-donut feature stay "Unclassified" forever —
  // the spec § 5 explicitly promises the refresh path fixes this.
  // Independent of snapshot derivation and fund sync — its own branch so
  // a Yahoo failure here doesn't block the others.
  const enrichmentPromise = (async (): Promise<RefreshBranchOutcome<{ enriched: number }>> => {
    try {
      const holdings = new HoldingsRepo(db);
      const tickers = new TickersRepo(db);
      const yahoo = new YahooClient();
      const allHoldings = await holdings.listAll();
      const distinctTickers = [...new Set(allHoldings.map((h) => h.ticker))];
      // Sequential — a concurrent assetProfile burst trips Yahoo's
      // quoteSummary 429 limiter, and enrichTickerIfMissing silently swallows
      // those failures (leaving sector NULL) for existing tickers with no
      // retry until the next refresh, so the parallel version could
      // permanently drop sector enrichment for individual stocks. A serial
      // loop spreads the calls out so each ticker gets a real shot.
      // enrichTickerIfMissing still short-circuits when sector is already
      // populated and swallows its own per-ticker errors, so this stays
      // O(network calls) only for the unenriched subset and one failure can't
      // abort the rest.
      let enriched = 0;
      let updated52w = 0;
      for (const ticker of distinctTickers) {
        if (await enrichTickerIfMissing(ticker, { yahoo, tickers })) enriched += 1;
        // 52-week range rides the SAME serial, user-initiated loop (D-P4
        // revised: one summaryDetail call per held ticker per refresh, spread
        // out exactly like the enrichment calls — no new network behavior
        // category, and the 24h Rust crumb cache keeps the auth cost flat).
        // Unlike sector enrichment it runs on EVERY refresh: the range
        // drifts weekly, and every-refresh auto-backfills pre-0053 rows.
        if (await updateTicker52Week(ticker, { yahoo, tickers })) updated52w += 1;
      }
      // Refeed once after the serial loop (not per ticker, round-2 C2): the
      // tickers store powers the unclassified banner, donut groupings, AND
      // the Positions 52-week cells.
      if (enriched > 0 || updated52w > 0) {
        void useTickersStore.getState().load();
      }
      // The branch's public result type ({ enriched }) is deliberately
      // UNCHANGED — no consumer needs the 52-week count (D-PT14).
      return { status: 'ok', result: { enriched } };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[market] background ticker enrichment failed:', err);
      return { status: 'error', error: toErrorMessage(err) };
    }
  })();

  // Derive today's per-account snapshot so the dashboard shows current
  // totals immediately after boot. Independent of the 12-month backfill
  // and fund sync — its own branch so a failure in either doesn't block
  // this, and vice versa.
  const snapshotPromise = (async (): Promise<RefreshBranchOutcome<DailySnapshotResult>> => {
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
      // Refeed mounted surfaces (Wave 2 §3): a fresh AUTO_DERIVED row is
      // invisible to stores hydrated before this branch landed — the dashboard
      // would show stale values under a fresh badge. Reload only when rows
      // actually changed; the store's in-flight de-dupe (createDedupedLoad,
      // create-entity-store.ts) makes an overlapping load a no-op, and
      // load() swallows its own errors, so this cannot crash the launch path.
      if (result.upserted.length > 0) {
        void useSnapshotsStore.getState().load();
      }
      return { status: 'ok', result };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[market] daily snapshot derivation failed:', err);
      return { status: 'error', error: toErrorMessage(err) };
    }
  })();

  // Each branch resolves (never rejects), so this aggregate never rejects.
  return (async () => ({
    fundSync: await fundSyncPromise,
    enrichment: await enrichmentPromise,
    snapshot: await snapshotPromise,
  }))();
}
