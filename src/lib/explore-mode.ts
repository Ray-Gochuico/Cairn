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
