import type { Database } from '@/db/db';
import { SettingsRepo } from '@/domain/app-settings';
import {
  shouldShowMonthlyPrompt,
  currentMonthYyyymm,
  MONTHLY_INPUT_GRACE_DAY,
} from '@/lib/input-pending';

/**
 * Reads last_seen_month, decides via the pure predicate + grace-window gate,
 * and — if this month is new — STAMPS the current month before returning.
 * Stamping at decide-time (even when grace suppresses the *route*) makes the
 * prompt fire at most once per calendar month. Returns true only when we should
 * AUTO-ROUTE (new month AND early-in-month). Cheap & heavy-compute-free: one
 * settings read + (at most) one write; NO accounts/snapshots/loans read. Never
 * throws into boot — the seam's caller treats a throw as "don't prompt"
 * (fail-quiet; the Dashboard banner still covers it).
 */
export async function evaluateAndStampMonthlyPrompt(
  db: Database,
  today: Date,
): Promise<boolean> {
  const repo = new SettingsRepo(db);
  const { lastSeenMonth } = await repo.get();
  if (!shouldShowMonthlyPrompt({ today, lastSeenMonth })) return false; // same month already
  // New month. Stamp now (consume this month's prompt) regardless of routing.
  await repo.update({ lastSeenMonth: currentMonthYyyymm(today) });
  // Auto-route ONLY if the first open of this month is early (within grace).
  // Past grace → suppress the route; the Dashboard banner takes over.
  return today.getDate() <= MONTHLY_INPUT_GRACE_DAY;
}

/**
 * Boot seam: decide + (if showing) replaceState to /monthly?from=new-month.
 * Pure-ish and INJECTABLE — pass a fake `win` ({ location, history }) in tests.
 * - Reads window.location.pathname; only acts on the root route ('/' | '').
 * - Skips if the path is not the root (first-launch /setup redirect already
 *   wins — a first-launch user is on /setup, not '/', when this runs).
 * - Delegates the read+decide+stamp to evaluateAndStampMonthlyPrompt,
 *   which also applies the grace-window suppression.
 * - On show: win.history.replaceState({}, '', '/monthly?from=new-month').
 *   The `?from=new-month` query param is the ONLY signal MonthlyMiniWindow uses
 *   to show the "It's a new month" eyebrow — it keeps the page free of any
 *   app_settings read (preserves D3).
 * - Returns true iff it redirected (for the test to assert on).
 * - Never throws into boot: callers wrap in try/catch (fail-quiet).
 */
export async function maybeRedirectToMonthly(
  db: Database,
  today: Date,
  win: {
    location: { pathname: string };
    history: { replaceState: History['replaceState'] };
  } = window,
): Promise<boolean> {
  const path = win.location.pathname;
  if (path !== '/' && path !== '') return false; // not root → no-op
  const show = await evaluateAndStampMonthlyPrompt(db, today);
  if (!show) return false;
  win.history.replaceState({}, '', '/monthly?from=new-month');
  return true;
}
