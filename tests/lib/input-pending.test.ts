import { describe, it, expect } from 'vitest';
import {
  isMonthlyInputPending,
  lastMonthYyyymm,
  currentMonthYyyymm,
  shouldShowMonthlyPrompt,
  MONTHLY_INPUT_GRACE_DAY,
} from '@/lib/input-pending';
import { SnapshotSource } from '@/types/enums';
import type { AccountSnapshot } from '@/types/schema';

function snap(
  accountId: number,
  snapshotDate: string,
  source: SnapshotSource,
): AccountSnapshot {
  return {
    id: accountId * 1000,
    accountId,
    snapshotDate,
    totalValue: 1000,
    source,
  };
}

describe('isMonthlyInputPending', () => {
  it('returns true on the 1st of the month even with no data', () => {
    const today = new Date(2026, 4, 1); // May 1
    expect(
      isMonthlyInputPending(today, { accountIds: [], snapshotsLastMonth: [] }),
    ).toBe(true);
  });

  it('still returns true on the 1st even when prior month is fully confirmed', () => {
    // The 1st-of-month nudge fires unconditionally — it's the "look at this
    // month's numbers, not last's" prompt, not a sanity check on what's saved.
    const today = new Date(2026, 4, 1);
    expect(
      isMonthlyInputPending(today, {
        accountIds: [1, 2],
        snapshotsLastMonth: [
          snap(1, '2026-04-30', SnapshotSource.USER_CONFIRMED),
          snap(2, '2026-04-30', SnapshotSource.MANUAL),
        ],
      }),
    ).toBe(true);
  });

  it('returns false during grace window (day 2..7) regardless of snapshot state', () => {
    for (const day of [2, 3, 5, 7]) {
      const today = new Date(2026, 4, day);
      expect(
        isMonthlyInputPending(today, {
          accountIds: [1],
          snapshotsLastMonth: [],
        }),
      ).toBe(false);
    }
  });

  it('returns false on day 15 when every account has a USER_CONFIRMED snapshot for last month', () => {
    const today = new Date(2026, 4, 15);
    expect(
      isMonthlyInputPending(today, {
        accountIds: [1, 2, 3],
        snapshotsLastMonth: [
          snap(1, '2026-04-30', SnapshotSource.USER_CONFIRMED),
          snap(2, '2026-04-30', SnapshotSource.USER_CONFIRMED),
          snap(3, '2026-04-30', SnapshotSource.USER_CONFIRMED),
        ],
      }),
    ).toBe(false);
  });

  it('returns false on day 15 when every account has a MANUAL snapshot', () => {
    const today = new Date(2026, 4, 15);
    expect(
      isMonthlyInputPending(today, {
        accountIds: [1, 2],
        snapshotsLastMonth: [
          snap(1, '2026-04-30', SnapshotSource.MANUAL),
          snap(2, '2026-04-30', SnapshotSource.MANUAL),
        ],
      }),
    ).toBe(false);
  });

  it('returns true on day 15 when one account is missing a snapshot', () => {
    const today = new Date(2026, 4, 15);
    expect(
      isMonthlyInputPending(today, {
        accountIds: [1, 2, 3],
        snapshotsLastMonth: [
          snap(1, '2026-04-30', SnapshotSource.USER_CONFIRMED),
          snap(2, '2026-04-30', SnapshotSource.USER_CONFIRMED),
          // account 3 missing
        ],
      }),
    ).toBe(true);
  });

  it('returns true on day 15 when all accounts only have AUTO_DERIVED snapshots', () => {
    const today = new Date(2026, 4, 15);
    expect(
      isMonthlyInputPending(today, {
        accountIds: [1, 2],
        snapshotsLastMonth: [
          snap(1, '2026-04-30', SnapshotSource.AUTO_DERIVED),
          snap(2, '2026-04-30', SnapshotSource.AUTO_DERIVED),
        ],
      }),
    ).toBe(true);
  });

  it('returns true on day 15 when one account is AUTO_DERIVED among confirmed siblings', () => {
    const today = new Date(2026, 4, 15);
    expect(
      isMonthlyInputPending(today, {
        accountIds: [1, 2],
        snapshotsLastMonth: [
          snap(1, '2026-04-30', SnapshotSource.USER_CONFIRMED),
          snap(2, '2026-04-30', SnapshotSource.AUTO_DERIVED),
        ],
      }),
    ).toBe(true);
  });

  it('returns false on day 15 when there are no accounts to confirm', () => {
    const today = new Date(2026, 4, 15);
    expect(
      isMonthlyInputPending(today, { accountIds: [], snapshotsLastMonth: [] }),
    ).toBe(false);
  });
});

describe('MONTHLY_INPUT_GRACE_DAY', () => {
  it('equals 7 (shared grace boundary — single source of truth)', () => {
    expect(MONTHLY_INPUT_GRACE_DAY).toBe(7);
  });
});

describe('currentMonthYyyymm', () => {
  it('formats the current month, zero-padded', () => {
    expect(currentMonthYyyymm(new Date(2026, 0, 15))).toBe('2026-01'); // Jan
    expect(currentMonthYyyymm(new Date(2026, 11, 1))).toBe('2026-12'); // Dec
  });

  it('handles mid-year dates', () => {
    expect(currentMonthYyyymm(new Date(2026, 4, 15))).toBe('2026-05'); // May
    expect(currentMonthYyyymm(new Date(2026, 5, 20))).toBe('2026-06'); // June
  });
});

describe('shouldShowMonthlyPrompt', () => {
  it('first-ever open (null lastSeenMonth) → true', () => {
    expect(shouldShowMonthlyPrompt({ today: new Date(2026, 0, 1), lastSeenMonth: null })).toBe(true);
  });

  it('Dec→Jan rollover → true', () => {
    expect(shouldShowMonthlyPrompt({ today: new Date(2026, 0, 1), lastSeenMonth: '2025-12' })).toBe(true);
  });

  it('new month mid-month → true', () => {
    expect(shouldShowMonthlyPrompt({ today: new Date(2026, 5, 20), lastSeenMonth: '2026-05' })).toBe(true);
  });

  it('same-month re-open → false (no re-show)', () => {
    expect(shouldShowMonthlyPrompt({ today: new Date(2026, 5, 20), lastSeenMonth: '2026-06' })).toBe(false);
  });

  it('idempotent same-day re-open after stamp → false', () => {
    // After a stamp, lastSeenMonth === currentMonth → stays false all month.
    expect(shouldShowMonthlyPrompt({ today: new Date(2026, 5, 1), lastSeenMonth: '2026-06' })).toBe(false);
  });
});

describe('lastMonthYyyymm', () => {
  it('returns previous month for mid-year dates', () => {
    expect(lastMonthYyyymm(new Date(2026, 4, 15))).toBe('2026-04');
  });

  it('rolls back from January to previous December', () => {
    expect(lastMonthYyyymm(new Date(2026, 0, 15))).toBe('2025-12');
  });

  it('handles the last day of a month', () => {
    expect(lastMonthYyyymm(new Date(2026, 2, 31))).toBe('2026-02');
  });
});
