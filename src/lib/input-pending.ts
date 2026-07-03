import type { AccountSnapshot } from '@/types/schema';
import { SnapshotSource } from '@/types/enums';

/**
 * Last day-of-month (inclusive) of the post-month-end grace window. Days
 * 2..GRACE are suppressed for `isMonthlyInputPending` (AUTO_DERIVED snapshots
 * usually land right after month-end). The Wave-3 auto-route reuses this as its
 * "early in the month" boundary: a NEW-month first open routes only when
 * today.getDate() <= MONTHLY_INPUT_GRACE_DAY; later first opens defer to the
 * Dashboard banner. Single source of truth — do not re-hard-code 7.
 */
export const MONTHLY_INPUT_GRACE_DAY = 7;

export interface InputPendingInput {
  /**
   * Account IDs that should have a monthly snapshot. Pass the non-cash,
   * non-excluded subset — cash balances are entered manually as of today,
   * not derived for last month, and excluded accounts opt out of net worth
   * entirely.
   */
  accountIds: number[];
  /**
   * Snapshots whose `snapshotDate` falls within last month. Callers can
   * either filter the full snapshot list or query AccountSnapshotsRepo
   * directly — the helper only inspects this array.
   */
  snapshotsLastMonth: AccountSnapshot[];
}

/**
 * Decides whether the user owes an end-of-month input ritual. Rule:
 *   - On day 1 of the month, always pending (the nudge day).
 *   - Days 2..7 are a grace window — AUTO_DERIVED snapshots typically land
 *     right after month-end, so we suppress the nudge for a week to avoid
 *     pinging users immediately.
 *   - On day > 7, pending if ANY tracked account is missing a USER_CONFIRMED
 *     or MANUAL snapshot for last month. AUTO_DERIVED alone counts as
 *     pending because the user hasn't ratified the derived value. A
 *     confirmed/manual row clears the account no matter how many auto rows
 *     surround it.
 *
 * Pure: no DB, no React, no globals. Caller composes the inputs.
 */
export function isMonthlyInputPending(
  today: Date,
  input: InputPendingInput,
): boolean {
  const day = today.getDate();
  if (day === 1) return true;
  if (day <= MONTHLY_INPUT_GRACE_DAY) return false;
  // day > 7: any account without a USER_CONFIRMED/MANUAL snapshot for last
  // month means input is still pending. Daily AUTO_DERIVED rows coexist with
  // the month-end confirmation, so the check must scan ALL of the account's
  // rows (.some), not just the first (.find) — an auto row must never mask a
  // real confirmation. No snapshot at all → pending. Empty accountIds →
  // nothing to confirm → not pending.
  return input.accountIds.some((accId) => {
    const confirmed = input.snapshotsLastMonth.some(
      (s) =>
        s.accountId === accId &&
        (s.source === SnapshotSource.USER_CONFIRMED ||
          s.source === SnapshotSource.MANUAL),
    );
    return !confirmed;
  });
}

/**
 * YYYY-MM string for the month before `today`. Handles January → previous
 * December rollover. Exposed so callers can match the slice the helper
 * expects without duplicating the date math.
 */
export function lastMonthYyyymm(today: Date): string {
  const year = today.getFullYear();
  const month = today.getMonth(); // 0-indexed; getMonth() === 0 in January
  const prev = new Date(year, month - 1, 1);
  const y = prev.getFullYear().toString().padStart(4, '0');
  const m = (prev.getMonth() + 1).toString().padStart(2, '0');
  return `${y}-${m}`;
}

/** YYYY-MM string for `today` (the current month). Mirrors lastMonthYyyymm. */
export function currentMonthYyyymm(today: Date): string {
  const y = today.getFullYear().toString().padStart(4, '0');
  const m = (today.getMonth() + 1).toString().padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * Decide whether to surface the new-month monthly-input prompt on app open.
 * Pure: inject `today` and the persisted `lastSeenMonth` (YYYY-MM | null).
 *   - lastSeenMonth === null  → true  (first-ever open; never prompted)
 *   - lastSeenMonth !== currentMonth(today) → true  (a new calendar month)
 *   - lastSeenMonth === currentMonth(today) → false (already prompted this month)
 * Caller stamps last_seen_month = currentMonthYyyymm(today) AFTER deciding to
 * show, so the prompt fires exactly once per calendar month (idempotent on
 * same-day re-open). Dec→Jan rollover is implicit: '2025-12' !== '2026-01'.
 */
export function shouldShowMonthlyPrompt(args: {
  today: Date;
  lastSeenMonth: string | null;
}): boolean {
  if (args.lastSeenMonth === null) return true;
  return args.lastSeenMonth !== currentMonthYyyymm(args.today);
}
