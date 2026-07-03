/**
 * In-flight de-dupe: concurrent load() calls must collapse to one DB query.
 * Re-load after settle must trigger a new DB query (so mutations remain visible).
 * Mirrors persons-store-inflight.test.ts — the guard matters here because the
 * always-mounted sidebar hook (use-monthly-input-pending) load()s this store
 * on every layout mount.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useAccountsStore } from '@/stores/accounts-store';
import { AccountsRepo } from '@/domain/accounts';

describe('useAccountsStore in-flight de-dupe', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    useAccountsStore.setState({ accounts: [], isLoading: false, error: null });
  });

  afterEach(async () => {
    await db.close();
  });

  it('two concurrent load() calls hit the underlying repo list() only once', async () => {
    // Spy BEFORE the calls so we see the real method.
    const listSpy = vi.spyOn(AccountsRepo.prototype, 'list');

    // Fire two concurrent loads without awaiting either.
    const p1 = useAccountsStore.getState().load();
    const p2 = useAccountsStore.getState().load();

    await Promise.all([p1, p2]);

    expect(listSpy).toHaveBeenCalledTimes(1);
    listSpy.mockRestore();
  });

  it('a load() after the previous one settles triggers a fresh DB query (re-load still works)', async () => {
    const listSpy = vi.spyOn(AccountsRepo.prototype, 'list');

    // First load
    await useAccountsStore.getState().load();
    // Second load — after settle → must be a fresh query
    await useAccountsStore.getState().load();

    expect(listSpy).toHaveBeenCalledTimes(2);
    listSpy.mockRestore();
  });
});
