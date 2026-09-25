import { TauriAdapter } from './tauri-adapter';
import { setDatabase } from './db';
import type { Database } from './db';
import {
  runMigrations,
  loadAllMigrations,
  pendingMigrations,
  readUserVersion,
  MAX_SCHEMA_VERSION,
  MigrationFailedError,
  type Migration,
} from './migrations';
import { assertDatabaseIntegrity } from './integrity';
import { runMarketDataRefresh } from '@/market/run-market-data-refresh';
import { SettingsRepo } from '@/domain/app-settings';
import { isRefreshDue } from '@/lib/refresh-cadence';
import { RefreshCadence } from '@/types/enums';
import {
  EXPLORE_DB_URL,
  ExploreBootError,
  clearExploreFlag,
  clearExplorePrefs,
  clearExploreSessionStorage,
  isExploreMode,
} from '@/lib/explore-mode';
import { resetSampleDb } from '@/db/sample-reset';
import { isTauriRuntime } from '@/lib/tauri-runtime';
import { takePreUpdateCopy } from '@/lib/pre-update-copy';
import { stashPostUpdateNotice, takeSkipOnce } from '@/lib/boot-notices';
import { tagDatabaseInitError } from './boot-errors';

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
    // W19: fire-and-forget by design — the aggregate never rejects, and
    // launch must not block on the network. Reporting callers await it.
    void runMarketDataRefresh(db);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[init] launch-refresh gating failed; running refresh anyway:', err);
    void runMarketDataRefresh(db);
  }
}

/**
 * W4 explore boot (D-S1/D-S2/D-S7): a pristine sample DB, rebuilt from
 * migrations + seed at the current MAX_SCHEMA_VERSION on EVERY boot. The
 * real DB is never opened while the flag is set — isolation is structural.
 * The sample is never migrated, never backed up, never corrupt-recovered:
 * those problem classes are out by construction (it is always a just-built
 * file, so assertDatabaseIntegrity trivially passes and SchemaTooNewError
 * is unreachable).
 */
async function initExploreDatabase(): Promise<void> {
  await resetSampleDb(); // idempotent delete; also drops a prior session's pool
  const adapter = await TauriAdapter.load(EXPLORE_DB_URL);
  setDatabase(adapter);
  await assertDatabaseIntegrity(adapter);
  const migrations = await loadAllMigrations();
  await runMigrations(adapter, migrations);
  const { seedSampleProfile } = await import('@/domain/sample-profile/sample-profile');
  await seedSampleProfile(adapter);
  // Deliberately NOT maybeRunLaunchRefresh — explore is offline (D-S7).
}

/**
 * v1.7.1 U1 (CR-U-1/3/5): the automatic pre-update safety copy. Runs on the
 * REAL profile only (the explore branch never reaches it), in the Tauri
 * runtime only, only on an UPDATING boot (a database that already has
 * migrations AND has at least one pending; a fresh file has nothing to
 * protect), and STRICTLY BEFORE runMigrations. The runner stamps
 * user_version even when nothing is pending, so a copy taken afterwards would
 * be refused by the previous build.
 *
 * `updating` also tells initDatabase whether a runMigrations failure is an
 * update failure (D-U1-19): the runner writes on every boot, so a read-only
 * or full file can fail it with nothing pending, and that is not an update.
 * A file too new for this build takes no copy (runMigrations throws
 * SchemaTooNewError next). A file left partway by an earlier boot
 * (0 < user_version < applied, the pre-U3 signal) resumes from the copy that
 * chain started from (D-U1-17). `skipCopy` is "Continue without a copy",
 * consumed by initDatabase at the start of the real branch (D-U1-13).
 *
 * A PreUpdateCopyError propagates: main.tsx renders the fail-closed choice
 * and nothing has been migrated.
 */
export async function maybeTakePreUpdateCopy(
  db: Database,
  migrations: Migration[],
  opts: { skipCopy?: boolean } = {},
): Promise<PreUpdateGate> {
  const { applied, pending } = await pendingMigrations(db, migrations);
  const updating = applied > 0 && pending.length > 0;
  if (!updating) return { copyPath: null, updating };
  const userVersion = await readUserVersion(db);
  if (userVersion > MAX_SCHEMA_VERSION) return { copyPath: null, updating };
  if (!isTauriRuntime() || opts.skipCopy) return { copyPath: null, updating };
  const originFrom = userVersion > 0 && userVersion < applied ? userVersion : undefined;
  const { path } = await takePreUpdateCopy({ from: applied, to: migrations.length, now: new Date(), originFrom });
  return { copyPath: path, updating };
}

export interface PreUpdateGate {
  /** The copy taken or reused before this boot's migrations; null when none was. */
  copyPath: string | null;
  /** True when existing data is about to change: applied > 0 and something is pending. */
  updating: boolean;
}

export async function initDatabase(): Promise<void> {
  if (isExploreMode()) {
    try {
      await initExploreDatabase();
    } catch (e) {
      // W4 review (MINOR 0/4/18): never strand the user inside a sample
      // profile that cannot open. The flag is what makes every relaunch
      // re-enter this branch, and the banner — the only exit control — never
      // mounts on a failed boot, so a Tauri user has no way to clear it
      // (WKWebView's localStorage is not reachable from the app). Drop the
      // flag and its namespaced prefs, then let main.tsx render the boot
      // error: the NEXT launch is the real profile by construction, and the
      // sample file was never the real DB, so leaving is always safe.
      clearExplorePrefs();
      // Same guarantee as the exit: raw session keys frozen modules wrote go
      // too (clearExploreSessionStorage's docblock has the reasoning).
      clearExploreSessionStorage();
      clearExploreFlag();
      // eslint-disable-next-line no-console
      console.warn('[explore] sample boot failed; leaving sample mode:', e);
      throw new ExploreBootError(e);
    }
    return;
  }
  // ——— the real profile ———
  const skipCopy = takeSkipOnce(); // every real boot consumes "Continue without a copy" (PR-13, D-U1-13)
  try {
    await initRealDatabase(skipCopy);
  } catch (e) {
    // CR-U-12 (U1-m33): tag every raw failure of the real-profile DATABASE
    // boot, so the boot screen offers its restore list only for a database
    // failure. The typed errors (corrupt, too new, the pre-update copy, a
    // failed update) pass through with their own screens.
    throw tagDatabaseInitError(e);
  }
}

/** The real-profile boot: the pre-v1.7.1 path plus the U1 copy seam. */
async function initRealDatabase(skipCopy: boolean): Promise<void> {
  const adapter = await TauriAdapter.load('sqlite:finance.db');
  setDatabase(adapter);

  // CORRUPTION CHECK (M1): before running migrations or reading any data, run a
  // fast structural integrity scan. A damaged file would otherwise surface as a
  // confusing mid-migration SQL error or wrong results; instead we throw a typed
  // DatabaseCorruptError that main.tsx renders as a recovery screen pointing the
  // user at their backups. Cheap enough for every boot (see assertDatabaseIntegrity).
  await assertDatabaseIntegrity(adapter);

  const migrations = await loadAllMigrations();
  // v1.7.1 U1: the safety copy, BEFORE the runner touches the file (order is
  // the guarantee — see maybeTakePreUpdateCopy). A failure here stops the boot
  // with the data untouched (CR-U-1).
  const gate = await maybeTakePreUpdateCopy(adapter, migrations, { skipCopy });
  try {
    await runMigrations(adapter, migrations);
  } catch (e) {
    // SchemaTooNewError is thrown before any migration runs — keep its screen.
    if (e instanceof Error && e.name === 'SchemaTooNewError') throw e;
    // Nothing was being updated (nothing pending, or a fresh file): not an
    // update failure, so the generic screen, as in 1.7.0 (D-U1-19).
    if (!gate.updating) throw e;
    throw new MigrationFailedError(e, gate.copyPath);
  }
  if (gate.copyPath !== null) stashPostUpdateNotice(gate.copyPath);

  // DEV-ONLY: populate demo data for browser smoke of the Investments donuts.
  // Triple-guarded so the entire branch dead-code-eliminates from the Tauri
  // prod bundle (which sets none of these Vite env vars). Runs BEFORE the
  // first-launch persons check in main.tsx so a smoke lands on /investments
  // without the /setup redirect, and seeds an app_wide disclosure acceptance
  // so AppDisclaimerGate doesn't block.
  // See src/domain/sample-profile/sample-profile.ts and docs/runbooks/populated-donut-smoke.md.
  if (
    import.meta.env.DEV &&
    import.meta.env.VITE_BROWSER_SHIM === '1' &&
    import.meta.env.VITE_SEED_DEMO === '1'
  ) {
    const { seedSampleProfile } = await import('@/domain/sample-profile/sample-profile');
    await seedSampleProfile(adapter);
  }

  // Run the background market-data derivations only when the configured
  // refresh cadence says a launch refresh is due.
  await maybeRunLaunchRefresh(adapter);
}
