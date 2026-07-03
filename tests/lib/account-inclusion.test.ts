import { describe, it, expect } from 'vitest';
import {
  includedAccountIds,
  filterSnapshotsForNetWorth,
} from '@/lib/account-inclusion';

const acct = (id: number | undefined, excluded: boolean) => ({
  id,
  excludedFromNetWorth: excluded,
});

describe('includedAccountIds', () => {
  it('returns ids of non-excluded accounts only', () => {
    expect(
      includedAccountIds([acct(1, false), acct(2, true), acct(3, false)]),
    ).toEqual(new Set([1, 3]));
  });

  it('skips accounts without an id (unsaved rows)', () => {
    expect(includedAccountIds([acct(undefined, false)])).toEqual(new Set());
  });

  it('empty input → empty set', () => {
    expect(includedAccountIds([])).toEqual(new Set());
  });
});

describe('filterSnapshotsForNetWorth', () => {
  const snaps = [
    { accountId: 1, snapshotDate: '2026-06-01', totalValue: 100 },
    { accountId: 2, snapshotDate: '2026-06-01', totalValue: 50 },
    { accountId: 99, snapshotDate: '2026-06-01', totalValue: 7 },
  ];

  it('drops snapshots belonging to excluded accounts', () => {
    const out = filterSnapshotsForNetWorth(snaps, [acct(1, false), acct(2, true)]);
    expect(out.map((s) => s.accountId)).toEqual([1, 99]);
  });

  it('unknown accountIds pass through (excluded-set semantics)', () => {
    const out = filterSnapshotsForNetWorth(snaps, [acct(1, false)]);
    expect(out).toHaveLength(3);
  });

  it('empty accounts array (store not hydrated yet) filters nothing', () => {
    expect(filterSnapshotsForNetWorth(snaps, [])).toHaveLength(3);
  });

  it('preserves the snapshot objects and their order', () => {
    const out = filterSnapshotsForNetWorth(snaps, [acct(2, true)]);
    expect(out[0]).toBe(snaps[0]);
    expect(out[1]).toBe(snaps[2]);
  });
});
