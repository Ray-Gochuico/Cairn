/**
 * Optimistic upsert/remove coverage for the account-snapshots store.
 * Real :memory: DB (full migration chain, FKs ON since 0030) — an account
 * row is seeded first so snapshot FKs hold.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { AccountSnapshotsRepo } from '@/domain/snapshots';
import { SnapshotSource } from '@/types/enums';

describe('useSnapshotsStore', () => {
  let db: SqliteAdapter;
  let accountId: number;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    // Seed one account directly (column list mirrors tests/stores/accounts-store.test.ts).
    await db.execute(
      `INSERT INTO accounts (
        household_id, owner_person_id, beneficiary_dependent_id, name, institution,
        type, crypto_wallet_address, auto_fetch_enabled, excluded_from_net_worth, state_of_plan
      ) VALUES (1, NULL, NULL, 'Brokerage', 'Vanguard', 'ACCOUNT_BROKERAGE', NULL, 0, 0, NULL)`,
    );
    const rows = await db.select<{ id: number }>('SELECT id FROM accounts ORDER BY id DESC LIMIT 1');
    accountId = rows[0].id;
    useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null });
  });

  afterEach(async () => {
    await db.close();
  });

  const snap = (over: Partial<{ snapshotDate: string; totalValue: number }> = {}) => ({
    accountId,
    snapshotDate: over.snapshotDate ?? '2026-06-30',
    totalValue: over.totalValue ?? 10_000,
    source: SnapshotSource.MANUAL,
  });

  it('upsert insert path: temp negative id appears synchronously, then swaps to the real id', async () => {
    const p = useSnapshotsStore.getState().upsert(snap());
    const during = useSnapshotsStore.getState().snapshots;
    expect(during).toHaveLength(1);
    expect(during[0].id).toBeLessThan(0); // optimistic temp id
    const realId = await p;
    expect(realId).toBeGreaterThan(0);
    const after = useSnapshotsStore.getState().snapshots;
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(realId);
    expect(after[0].totalValue).toBe(10_000);
  });

  it('upsert update path: matching (accountId, snapshotDate) replaces in place, id stays real', async () => {
    const realId = await useSnapshotsStore.getState().upsert(snap({ totalValue: 10_000 }));
    await useSnapshotsStore.getState().upsert(snap({ totalValue: 12_345 }));
    const rows = useSnapshotsStore.getState().snapshots;
    expect(rows).toHaveLength(1); // natural-key upsert, no duplicate row
    expect(rows[0].id).toBe(realId);
    expect(rows[0].totalValue).toBe(12_345);
  });

  it('upsert rollback: repo failure restores the pre-write array and rethrows', async () => {
    await useSnapshotsStore.getState().upsert(snap({ snapshotDate: '2026-05-31', totalValue: 5_000 }));
    const before = useSnapshotsStore.getState().snapshots;
    const spy = vi
      .spyOn(AccountSnapshotsRepo.prototype, 'upsert')
      .mockRejectedValueOnce(new Error('upsert failed'));
    await expect(useSnapshotsStore.getState().upsert(snap())).rejects.toThrow('upsert failed');
    expect(useSnapshotsStore.getState().snapshots).toEqual(before);
    spy.mockRestore();
  });

  it('remove rollback: repo failure re-inserts the deleted row (re-sorted) and rethrows', async () => {
    const id1 = await useSnapshotsStore.getState().upsert(snap({ snapshotDate: '2026-04-30' }));
    const id2 = await useSnapshotsStore.getState().upsert(snap({ snapshotDate: '2026-05-31' }));
    const spy = vi
      .spyOn(AccountSnapshotsRepo.prototype, 'delete')
      .mockRejectedValueOnce(new Error('delete failed'));
    await expect(useSnapshotsStore.getState().remove(id1)).rejects.toThrow('delete failed');
    // Restored AND back in date-asc order (mirrors the load() SELECT ordering).
    expect(useSnapshotsStore.getState().snapshots.map((s) => s.id)).toEqual([id1, id2]);
    spy.mockRestore();
  });

  it('remove really deletes on success', async () => {
    const id = await useSnapshotsStore.getState().upsert(snap());
    await useSnapshotsStore.getState().remove(id);
    expect(useSnapshotsStore.getState().snapshots).toEqual([]);
    await useSnapshotsStore.getState().load();
    expect(useSnapshotsStore.getState().snapshots).toEqual([]); // gone in the DB too
  });

  it('load() de-dupes concurrent calls (existing snapshotsInflight guard)', async () => {
    const selectSpy = vi.spyOn(db, 'select');
    const p1 = useSnapshotsStore.getState().load();
    const p2 = useSnapshotsStore.getState().load();
    await Promise.all([p1, p2]);
    const snapshotSelects = selectSpy.mock.calls.filter(([sql]) =>
      String(sql).includes('FROM account_snapshots'),
    );
    expect(snapshotSelects).toHaveLength(1);
    selectSpy.mockRestore();
  });
});
