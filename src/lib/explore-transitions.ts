import { getDatabase } from '@/db/db';
import { resetSampleDb } from '@/db/sample-reset';
import { clearExploreFlag, clearExplorePrefs, setExploreFlag } from '@/lib/explore-mode';

/**
 * The two explore transitions (W4 D-S4). Both are FULL navigations to '/' —
 * the restore-proven "change the DB under the app and reboot" primitive —
 * with one deliberate difference from restore's reload(): the exit MUST land
 * on '/' because shouldRedirectToSetup only hijacks '/' (setup-dismissal.ts)
 * — a plain reload from /investments would strand the fresh profile on an
 * empty page with no wizard. No runtime setDatabase swap, no store
 * re-hydration: immune to the shared-store gate boot loop by construction.
 *
 * Deps are injectable for tests; defaults are the real implementations.
 */
export interface ExploreTransitionDeps {
  closeDb: () => Promise<void>;
  reset: () => Promise<void>;
  navigate: (path: string) => void;
}

function defaultDeps(): ExploreTransitionDeps {
  return {
    closeDb: () => getDatabase().close(),
    reset: () => resetSampleDb(),
    navigate: (path) => window.location.assign(path),
  };
}

/**
 * Entry (from Step 0, AFTER the app_wide acceptance was awaited on the REAL
 * DB). close() drains the Tauri pool / runs the shim's synchronous final
 * IndexedDB persist — closing the 250 ms flush-debounce window so the
 * acceptance provably lands before the reload (the shim-persistence gotcha).
 * The boot wipe owns sample cleanliness; entry never touches the sample file.
 */
export async function enterExploreMode(
  deps: ExploreTransitionDeps = defaultDeps(),
): Promise<void> {
  await deps.closeDb();
  try {
    setExploreFlag();
  } catch (e) {
    // Degraded-but-honest: without the flag the navigation boots the real
    // profile; the acceptance is durable, so the wizard resumes at FlowShell.
    // eslint-disable-next-line no-console
    console.warn('[explore] could not set the sample-mode flag:', e);
  }
  deps.navigate('/');
}

/**
 * Exit ("Start my real setup"). The wipe is best-effort — a failure is
 * logged and NEVER blocks the exit (a stale sample file is inert; the next
 * entry's boot wipe reaps it). The flag clears unconditionally.
 */
export async function exitExploreMode(
  deps: ExploreTransitionDeps = defaultDeps(),
): Promise<void> {
  try {
    await deps.closeDb();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[explore] sample close failed:', e);
  }
  try {
    await deps.reset();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[explore] sample wipe failed (stale file is inert; next entry re-wipes):', e);
  }
  // W4 review (MAJOR 1/2): drop every explore-namespaced device pref BEFORE
  // the flag — donut hidden sets and chart selections hold SAMPLE row ids,
  // and the backtest cache holds a sample verdict; the real DB reissues those
  // ids from 1, so anything surviving here mis-targets the user's own rows.
  clearExplorePrefs();
  clearExploreFlag();
  deps.navigate('/');
}
