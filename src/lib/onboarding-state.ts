/**
 * Onboarding "done" markers (per-device UX flags), mirroring the fail-open
 * localStorage idiom in `setup-dismissal.ts`.
 *
 * Two independent flags:
 *  - tailor done: the user has been through (or skipped) the post-setup
 *    "tailor your tools" step.
 *  - tour done: the user has finished (or skipped) the guided spotlight tour.
 *
 * Both are intentionally NOT backed up (they are device-local UX state, not
 * financial data — same call as `setupWizard.dismissed.v1`). Reads fail OPEN
 * to `false` so a storage hiccup can never wedge a user out of, or re-trap a
 * user into, the onboarding flow; writes are best-effort.
 */
export const ONBOARDING_TAILOR_DONE_KEY = 'onboarding.tailor.done.v1';
export const ONBOARDING_TOUR_DONE_KEY = 'onboarding.tour.done.v1';

/** True once the user has completed or skipped the Tailor step. */
export function isTailorDone(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_TAILOR_DONE_KEY) !== null;
  } catch {
    return false;
  }
}

/** Persist the Tailor-done marker. Best-effort. */
export function markTailorDone(): void {
  try {
    localStorage.setItem(ONBOARDING_TAILOR_DONE_KEY, new Date().toISOString());
  } catch {
    // Best-effort: a storage failure simply means the prompt may re-show; it
    // must never throw into a React event handler / navigation path.
  }
}

/** True once the user has completed or skipped the guided tour. */
export function isTourDone(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_TOUR_DONE_KEY) !== null;
  } catch {
    return false;
  }
}

/** Persist the tour-done marker. Best-effort. */
export function markTourDone(): void {
  try {
    localStorage.setItem(ONBOARDING_TOUR_DONE_KEY, new Date().toISOString());
  } catch {
    // Best-effort; see markTailorDone.
  }
}
