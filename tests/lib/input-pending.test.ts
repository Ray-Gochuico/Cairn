import { describe, it, expect } from 'vitest';
import {
  isMonthlyInputPending,
  lastMonthYyyymm,
  currentMonthYyyymm,
  shouldShowMonthlyPrompt,
  monthlyInputPendingFor,
  monthlyInputUnconfirmedFor,
  pendingCloseAccountIds,
  MONTHLY_INPUT_GRACE_DAY,
} from '@/lib/input-pending';
import { AccountType, SnapshotSource } from '@/types/enums';
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

  it('day 15: a USER_CONFIRMED row clears the account even when daily AUTO_DERIVED rows also exist', () => {
    const today = new Date(2026, 4, 15);
    expect(
      isMonthlyInputPending(today, {
        accountIds: [1],
        snapshotsLastMonth: [
          snap(1, '2026-04-01', SnapshotSource.AUTO_DERIVED),
          snap(1, '2026-04-15', SnapshotSource.AUTO_DERIVED),
          snap(1, '2026-04-30', SnapshotSource.USER_CONFIRMED),
        ],
      }),
    ).toBe(false);
  });

  it('day 15: order-independent — confirmation first or last in the array', () => {
    const today = new Date(2026, 4, 15);
    const rows = [
      snap(1, '2026-04-30', SnapshotSource.MANUAL),
      snap(1, '2026-04-01', SnapshotSource.AUTO_DERIVED),
    ];
    expect(
      isMonthlyInputPending(today, { accountIds: [1], snapshotsLastMonth: rows }),
    ).toBe(false);
    expect(
      isMonthlyInputPending(today, {
        accountIds: [1],
        snapshotsLastMonth: [...rows].reverse(),
      }),
    ).toBe(false);
  });

  it('day 15: one account confirmed does not clear a sibling with only AUTO_DERIVED rows', () => {
    const today = new Date(2026, 4, 15);
    expect(
      isMonthlyInputPending(today, {
        accountIds: [1, 2],
        snapshotsLastMonth: [
          snap(1, '2026-04-30', SnapshotSource.USER_CONFIRMED),
          snap(2, '2026-04-02', SnapshotSource.AUTO_DERIVED),
        ],
      }),
    ).toBe(true);
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

describe('monthlyInputPendingFor (whole-store composition)', () => {
  const day15 = new Date('2026-06-15T12:00:00Z'); // past the day-7 grace window
  const acct = (id: number, type: AccountType, excluded = false) =>
    ({ id, type, excludedFromNetWorth: excluded }) as never;
  const wsnap = (accountId: number, date: string, source: SnapshotSource) =>
    ({ id: accountId * 100, accountId, snapshotDate: date, totalValue: 1, source }) as never;

  it('pending when an auto-derived account has no confirmed/manual snapshot last month', () => {
    expect(
      monthlyInputPendingFor(day15, [acct(1, AccountType.ACCOUNT_BROKERAGE)], [
        wsnap(1, '2026-05-29', SnapshotSource.AUTO_DERIVED),
      ]),
    ).toBe(true);
  });

  it('clear when last month is confirmed', () => {
    expect(
      monthlyInputPendingFor(day15, [acct(1, AccountType.ACCOUNT_BROKERAGE)], [
        wsnap(1, '2026-05-29', SnapshotSource.USER_CONFIRMED),
      ]),
    ).toBe(false);
  });

  it('manual-balance types and excluded accounts never count', () => {
    expect(
      monthlyInputPendingFor(day15, [
        acct(1, AccountType.ACCOUNT_CASH),
        acct(2, AccountType.ACCOUNT_SAVINGS),
        acct(3, AccountType.ACCOUNT_CRYPTO),
        acct(4, AccountType.ACCOUNT_BROKERAGE, true),
      ], []),
    ).toBe(false);
  });

  it('only last-month snapshots are considered (an old confirmation does not clear)', () => {
    expect(
      monthlyInputPendingFor(day15, [acct(1, AccountType.ACCOUNT_BROKERAGE)], [
        wsnap(1, '2026-04-30', SnapshotSource.USER_CONFIRMED),
      ]),
    ).toBe(true);
  });
});

// C034 (v1.8.0 W4): ONE definition of "balances to confirm" for last month's
// close. An account first entered after last month ended has nothing to close;
// it joins once it has a snapshot dated in or before last month. Literal days.
describe('pendingCloseAccountIds (C034: the one close selector)', () => {
  const nov14 = new Date(2026, 10, 14); // the October close
  const acct = (id: number, type: AccountType, excluded = false) =>
    ({ id, type, excludedFromNetWorth: excluded }) as never;
  const row = (accountId: number, date: string, source: SnapshotSource) =>
    ({ id: accountId * 100 + Number(date.slice(8)), accountId, snapshotDate: date, totalValue: 1, source }) as never;

  it('a fresh setup on Nov 14 (rows dated that day) has nothing to close for October', () => {
    const accounts = [acct(1, AccountType.ACCOUNT_401K), acct(2, AccountType.ACCOUNT_ROTH_IRA), acct(3, AccountType.ACCOUNT_CASH)];
    const snaps = [row(1, '2026-11-14', SnapshotSource.MANUAL), row(2, '2026-11-14', SnapshotSource.MANUAL), row(3, '2026-11-14', SnapshotSource.MANUAL)];
    expect(monthlyInputPendingFor(nov14, accounts, snaps)).toBe(false);
    expect(monthlyInputUnconfirmedFor(nov14, accounts, snaps)).toBe(false);
    expect(pendingCloseAccountIds(nov14, accounts, snaps)).toEqual([]);
  });

  it('an account with no snapshot at all is not counted', () => {
    expect(monthlyInputUnconfirmedFor(nov14, [acct(1, AccountType.ACCOUNT_BROKERAGE)], [])).toBe(false);
    expect(pendingCloseAccountIds(nov14, [acct(1, AccountType.ACCOUNT_BROKERAGE)], [])).toEqual([]);
  });

  it('entered in September and never confirmed in October: counted', () => {
    const accounts = [acct(1, AccountType.ACCOUNT_401K), acct(2, AccountType.ACCOUNT_HSA)];
    const snaps = [row(1, '2026-09-10', SnapshotSource.MANUAL), row(2, '2026-09-10', SnapshotSource.MANUAL), row(2, '2026-11-02', SnapshotSource.MANUAL)];
    expect(pendingCloseAccountIds(nov14, accounts, snaps)).toEqual([1, 2]);
    expect(monthlyInputUnconfirmedFor(nov14, accounts, snaps)).toBe(true);
  });

  it('an AUTO_DERIVED row in October counts the account; a MANUAL or USER_CONFIRMED row in October clears it', () => {
    const accounts = [acct(1, AccountType.ACCOUNT_BROKERAGE), acct(2, AccountType.ACCOUNT_BROKERAGE), acct(3, AccountType.ACCOUNT_BROKERAGE)];
    const snaps = [
      row(1, '2026-10-29', SnapshotSource.AUTO_DERIVED),
      row(2, '2026-10-29', SnapshotSource.AUTO_DERIVED), row(2, '2026-10-29', SnapshotSource.USER_CONFIRMED),
      row(3, '2026-10-15', SnapshotSource.MANUAL),
    ];
    expect(pendingCloseAccountIds(nov14, accounts, snaps)).toEqual([1]);
  });

  it('cash, savings, crypto and excluded accounts never count', () => {
    const accounts = [
      acct(1, AccountType.ACCOUNT_CASH), acct(2, AccountType.ACCOUNT_SAVINGS),
      acct(3, AccountType.ACCOUNT_CRYPTO), acct(4, AccountType.ACCOUNT_BROKERAGE, true),
    ];
    const snaps = [1, 2, 3, 4].map((id) => row(id, '2026-09-10', SnapshotSource.MANUAL));
    expect(pendingCloseAccountIds(nov14, accounts, snaps)).toEqual([]);
  });

  it('the January close of a November setup counts it (the year boundary)', () => {
    const jan12 = new Date(2027, 0, 12); // the December close
    const snaps = [row(1, '2026-11-14', SnapshotSource.MANUAL)];
    expect(monthlyInputPendingFor(jan12, [acct(1, AccountType.ACCOUNT_401K)], snaps)).toBe(true);
    expect(pendingCloseAccountIds(jan12, [acct(1, AccountType.ACCOUNT_401K)], snaps)).toEqual([1]);
  });
});
