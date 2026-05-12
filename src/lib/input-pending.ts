import type { AccountSnapshot } from '@/types/schema';
import { SnapshotSource } from '@/types/enums';

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
 *     pending because the user hasn't ratified the derived value.
 *
 * Pure: no DB, no React, no globals. Caller composes the inputs.
 */
export function isMonthlyInputPending(
  today: Date,
  input: InputPendingInput,
): boolean {
  const day = today.getDate();
  if (day === 1) return true;
  if (day <= 7) return false;
  // day > 7: any account without a USER_CONFIRMED/MANUAL snapshot for last
  // month means input is still pending. Empty accountIds → nothing to
  // confirm → not pending.
  return input.accountIds.some((accId) => {
    const snap = input.snapshotsLastMonth.find((s) => s.accountId === accId);
    return (
      !snap ||
      (snap.source !== SnapshotSource.USER_CONFIRMED &&
        snap.source !== SnapshotSource.MANUAL)
    );
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
