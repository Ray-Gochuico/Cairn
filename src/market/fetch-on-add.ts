import type { Database } from '@/db/db';
import { runMarketDataRefresh } from './run-market-data-refresh';
import { isExploreMode } from '@/lib/explore-mode';

/**
 * How long a burst window lasts. Adds within this window of the last run
 * coalesce into one trailing refresh instead of firing N near-simultaneous
 * refreshes (Yahoo's quoteSummary 429 limiter punishes bursts).
 */
const BURST_WINDOW_MS = 2_000;

let lastRunAt = -Infinity;
let trailing: ReturnType<typeof setTimeout> | null = null;

/**
 * W19 fetch-on-add: request a market-data refresh because a holding was just
 * created, its ticker was changed, or a CSV holding import committed. Without
 * this, a new ticker's price (and the account's re-derived snapshot) waited
 * for the next cadence-due refresh — up to 24h on DAILY, 7d on WEEKLY,
 * forever on MANUAL — so fresh holdings showed $0 with no hint why.
 *
 * Behavior: a lone add runs `runMarketDataRefresh` immediately (leading
 * edge); further adds inside the burst window coalesce into ONE trailing
 * refresh after the window, which picks up every ticker added during the
 * burst (the refresh derives its ticker set from holdings.listAll()). The
 * refresh itself is cheap to re-run: the 6h price-cache TTL means only NEW
 * tickers hit the network, enrichment early-exits on enriched tickers, and
 * the fund sync has a 90-day gate.
 *
 * Deliberately does NOT stamp last_refresh_at: this is data repair for one
 * ticker, not a user-cadence refresh — stamping would suppress the next due
 * launch refresh.
 *
 * W4 review (MINOR 1): a no-op while exploring. D-S7 makes the sample session
 * 100% offline — the seeded prices ARE the pinned narrative, and a live quote
 * would silently repaint them mid-tour.
 */
export function fetchMarketDataOnAdd(db: Database): void {
  if (isExploreMode()) return;
  const now = Date.now();
  if (trailing === null && now - lastRunAt > BURST_WINDOW_MS) {
    lastRunAt = now;
    void runMarketDataRefresh(db);
    return;
  }
  if (trailing === null) {
    trailing = setTimeout(() => {
      trailing = null;
      lastRunAt = Date.now();
      void runMarketDataRefresh(db);
    }, BURST_WINDOW_MS);
  }
}
