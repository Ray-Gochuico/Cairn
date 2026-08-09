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

// Progress keys + the in-progress predicate live in the shared v2 progress
// module now (worded-onboarding wave); re-exported here so existing importers
// (Dashboard resume nudge, tests) are untouched. hasSetupInProgress counts
// v2 OR a leftover v1 key.
export {
  SETUP_PROGRESS_V1_KEY as SETUP_PROGRESS_KEY,
  hasSetupInProgress,
} from '@/lib/setup-progress';

import { clearSetupProgress } from '@/lib/setup-progress';
import { isTailorDone } from '@/lib/onboarding-state';

/**
 * The ONE Finish implementation shared by the card wizard and the worded flow
 * (design: byte-identical to the shipped SectionLayout.handleFinish). New
 * users go to /welcome; re-entrant users with Tailor done go to the Dashboard.
 */
export function finishSetup(navigate: (to: string) => void): void {
  markSetupDismissed();
  clearSetupProgress();
  navigate(isTailorDone() ? '/' : '/welcome');
}
