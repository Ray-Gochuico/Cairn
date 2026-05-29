import { TauriAdapter } from './tauri-adapter';
import { setDatabase } from './db';
import type { Database } from './db';
import { runMigrations, loadAllMigrations } from './migrations';
import { runMarketDataRefresh } from '@/market/run-market-data-refresh';
import { SettingsRepo } from '@/domain/app-settings';
import { isRefreshDue } from '@/lib/refresh-cadence';
import { RefreshCadence } from '@/types/enums';

/**
 * Decide whether to run the background market-data refresh on launch.
 *
 * Reads `app_settings`, and runs `runMarketDataRefresh` when `isRefreshDue`
 * says so for the stored cadence. When it runs, the launch stamps
 * `last_refresh_at` with the current ISO timestamp at initiation — the
 * derivations are best-effort background work that swallow their own errors,
 * so the initiation moment is the meaningful "last refreshed" marker. A
 * failure reading settings falls through to running the refresh, the safe
 * default (matching the pre-Settings always-on behavior).
 *
 * Bootstrap exception: with forward-only snapshots, a DB can have zero
 * `account_snapshots` while `last_refresh_at` is recent — e.g. migration 0040
 * wiped synthetic history on a day a refresh had already run. Under DAILY /
 * WEEKLY that makes `isRefreshDue` false, so no snapshot is ever derived and
 * every value-based view (allocation, time series, growth) renders empty until
 * the next calendar day. When snapshots are empty we force one refresh so
 * today's snapshot is derived and the app self-heals. MANUAL is respected:
 * those users deliberately opted out of automatic refresh and use "Refresh
 * now" themselves.
 */
export async function maybeRunLaunchRefresh(db: Database): Promise<void> {
  try {
    const repo = new SettingsRepo(db);
    const settings = await repo.get();
    const due = isRefreshDue(settings.refreshCadence, settings.lastRefreshAt, new Date());

    let needsBootstrap = false;
    if (!due && settings.refreshCadence !== RefreshCadence.MANUAL) {
      const rows = await db.select<{ n: number }>(
        'SELECT COUNT(*) AS n FROM account_snapshots',
      );
      needsBootstrap = (rows[0]?.n ?? 0) === 0;
    }

    if (!due && !needsBootstrap) {
      return;
    }
    await repo.update({ lastRefreshAt: new Date().toISOString() });
    runMarketDataRefresh(db);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[init] launch-refresh gating failed; running refresh anyway:', err);
    runMarketDataRefresh(db);
  }
}

export async function initDatabase(): Promise<void> {
  const adapter = await TauriAdapter.load('sqlite:finance.db');
  setDatabase(adapter);
  const migrations = await loadAllMigrations();
  await runMigrations(adapter, migrations);

  // Run the background market-data derivations only when the configured
  // refresh cadence says a launch refresh is due.
  await maybeRunLaunchRefresh(adapter);
}
