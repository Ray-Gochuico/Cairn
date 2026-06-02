/**
 * "Setup dismissed/completed" marker.
 *
 * First-launch detection used to be purely "no persons exist", so a user who
 * legitimately skipped Section 1 (Persons) and added only accounts/holdings,
 * then clicked Finish setup, would be redirected back to /setup on every
 * subsequent launch (personCount stayed 0) — and `handleFinish` had already
 * cleared the wizard progress, so they restarted at Section 1 each time
 * (the H1 re-entry trap).
 *
 * The fix decouples "has the user finished onboarding" from "does a person row
 * exist": we persist an explicit dismissal marker (localStorage, mirroring the
 * existing `setupWizard.progress.v1` pattern) that `handleFinish` sets and the
 * first-launch redirect honors.
 */
export const SETUP_DISMISSED_KEY = 'setupWizard.dismissed.v1';

/** True once the user has finished (or otherwise dismissed) the setup wizard. */
export function isSetupDismissed(): boolean {
  try {
    return localStorage.getItem(SETUP_DISMISSED_KEY) !== null;
  } catch {
    // Fail-open to "not dismissed" — a storage error shouldn't strand a
    // genuine first-launch user away from the wizard.
    return false;
  }
}

/** Persist the dismissal marker. Called from the wizard's handleFinish. */
export function markSetupDismissed(): void {
  try {
    localStorage.setItem(SETUP_DISMISSED_KEY, new Date().toISOString());
  } catch {
    // Best-effort; if storage is unavailable the redirect still falls back to
    // the persons-count heuristic, which is the pre-fix behavior.
  }
}

export interface RedirectToSetupInput {
  /** Number of person rows in the DB. */
  personCount: number;
  /** Whether the user has previously dismissed/finished the wizard. */
  dismissed: boolean;
  /** Current location pathname at boot. */
  path: string;
}

/**
 * Pure first-launch redirect predicate. Redirect to /setup only when the user
 * has no persons AND has not previously dismissed the wizard AND is landing on
 * the root route (so we don't hijack deep links).
 */
export function shouldRedirectToSetup({
  personCount,
  dismissed,
  path,
}: RedirectToSetupInput): boolean {
  if (dismissed) return false;
  if (personCount !== 0) return false;
  return path === '/' || path === '';
}
