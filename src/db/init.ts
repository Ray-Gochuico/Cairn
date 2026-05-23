import { TauriAdapter } from './tauri-adapter';
import { setDatabase } from './db';
import type { Database } from './db';
import { runMigrations, loadAllMigrations } from './migrations';
import { runMarketDataRefresh } from '@/market/run-market-data-refresh';
import { SettingsRepo } from '@/domain/app-settings';
import { isRefreshDue } from '@/lib/refresh-cadence';

/**
 * Decide whether to run the background market-data refresh on launch.
 *
 * Reads `app_settings`, and runs `runMarketDataRefresh` only when
 * `isRefreshDue` says so for the stored cadence. When it runs, the launch
 * stamps `last_refresh_at` with the current ISO timestamp at initiation —
 * the derivations are best-effort background work that swallow their own
 * errors, so the initiation moment is the meaningful "last refreshed"
 * marker. A failure reading settings falls through to running the refresh,
 * the safe default (matching the pre-Settings always-on behavior).
 */
export async function maybeRunLaunchRefresh(db: Database): Promise<void> {
  try {
    const repo = new SettingsRepo(db);
    const settings = await repo.get();
    if (!isRefreshDue(settings.refreshCadence, settings.lastRefreshAt, new Date())) {
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
