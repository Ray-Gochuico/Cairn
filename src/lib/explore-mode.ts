/**
 * Device-local flag for "Explore with sample data" (v1.6.0 W4, D-S1/D-S2).
 *
 * The flag lives OUTSIDE the DB — it must survive the sample DB being absent
 * (each explore boot deletes and rebuilds it) — matching the house
 * device-local idiom (`setupWizard.dismissed.v1`, src/lib/setup-dismissal.ts).
 *
 * `isExploreMode()` is a BOOT CONSTANT: it is written/cleared only by the
 * enter/exit transitions in src/lib/explore-transitions.ts, each of which
 * immediately performs a full navigation (`window.location.assign('/')`), so
 * within any mounted page the value never changes. Read it freely during
 * render; no gate/latch/loading state exists by construction.
 */
export const EXPLORE_FLAG_KEY = 'explore.sampleMode.v1';

/**
 * The throwaway sample DB the explore boot opens. Mirrored in Rust as
 * `db_backup::SAMPLE_DB_URL` (the db_sample_reset allowlist) — pinned on both
 * sides and cross-language in tests/policy/ipc-parity.test.ts.
 */
export const EXPLORE_DB_URL = 'sqlite:sample-explore.db';

/** True while the app is in explore mode. Fail-closed to the real profile. */
export function isExploreMode(): boolean {
  try {
    return localStorage.getItem(EXPLORE_FLAG_KEY) !== null;
  } catch {
    // No localStorage ⇒ the flag could never have been set by entry either.
    return false;
  }
}

/**
 * Set by enterExploreMode() right before its navigation. May throw (quota /
 * private mode); the caller degrades honestly (see explore-transitions.ts).
 */
export function setExploreFlag(): void {
  localStorage.setItem(EXPLORE_FLAG_KEY, new Date().toISOString());
}

/** Best-effort removal — exit must never be blocked by storage errors. */
export function clearExploreFlag(): void {
  try {
    localStorage.removeItem(EXPLORE_FLAG_KEY);
  } catch {
    // Best-effort by design.
  }
}

/**
 * Namespace every explore-session device-local preference lives under. The
 * explore flag itself already carries it, so ONE prefix sweep at exit
 * (`clearExplorePrefs`) reaps the whole family.
 */
export const EXPLORE_PREF_PREFIX = 'explore.';

/**
 * W4 review (MAJOR 1/2): the key a device-local preference is stored under
 * while exploring.
 *
 * P-W4-10 keeps device UI prefs writable in explore on the premise that the
 * only ids they carry are migration-seeded constants. That premise is FALSE
 * for two families: donut hidden sets persist `entityKey(kind, id)` strings
 * (`account:2`, `loan:1`) and the asset-chart persists `{kind, id}` tuples —
 * and `backtest:last-run:v1` persists a computed VERDICT with a sample
 * person's name in it. The sample DB and the post-exit real DB both issue
 * autoincrement ids from 1, so a sample-era selection silently re-targets
 * the user's real rows (and a sample verdict headlines their real
 * Calculators page).
 *
 * Namespacing is preferred over "don't write in explore": the sample session
 * stays fully interactive (pickers, chart selections, a real backtest run)
 * and NOTHING it wrote outlives the exit.
 *
 * `isExploreMode()` is a boot constant, so this is stable for the lifetime of
 * a page — safe to call during render or at module scope.
 */
export function prefKey(base: string): string {
  return isExploreMode() ? `${EXPLORE_PREF_PREFIX}${base}` : base;
}

/**
 * Remove every explore-namespaced key from BOTH web stores. Called on the way
 * out (exitExploreMode) and on the explore-boot failure path, BEFORE the flag
 * is cleared — so the real profile that boots next sees only its own prefs.
 *
 * The sweep also reaps `EXPLORE_FLAG_KEY` itself (it carries the prefix);
 * callers still call `clearExploreFlag()` explicitly so the guarantee is
 * named rather than incidental. Best-effort: never throws, never blocks exit.
 */
export function clearExplorePrefs(): void {
  for (const store of [localStorage, sessionStorage]) {
    try {
      const doomed: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (k !== null && k.startsWith(EXPLORE_PREF_PREFIX)) doomed.push(k);
      }
      // Collect first, then delete: removing during the index walk shifts it.
      for (const k of doomed) store.removeItem(k);
    } catch {
      // Best-effort by design (private mode / quota / denied storage).
    }
  }
}
