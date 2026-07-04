/**
 * In-flight de-dupe: concurrent load() calls must collapse to one DB query.
 * Re-load after settle must trigger a new DB query (so mutations remain visible).
 * Household is a singleton — its repo read is get(), not list().
 * Pattern: tests/stores/persons-store-inflight.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useHouseholdStore } from '@/stores/household-store';
import { HouseholdRepo } from '@/domain/household';

describe('useHouseholdStore in-flight de-dupe', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    useHouseholdStore.setState({ household: null, isLoading: false, error: null });
  });

  afterEach(async () => {
    await db.close();
  });

  it('two concurrent load() calls hit the underlying repo get() only once', async () => {
    const getSpy = vi.spyOn(HouseholdRepo.prototype, 'get');
    const p1 = useHouseholdStore.getState().load();
    const p2 = useHouseholdStore.getState().load();
    await Promise.all([p1, p2]);
    expect(getSpy).toHaveBeenCalledTimes(1);
    getSpy.mockRestore();
  });

  it('a load() after the previous one settles triggers a fresh DB query', async () => {
    const getSpy = vi.spyOn(HouseholdRepo.prototype, 'get');
    await useHouseholdStore.getState().load();
    await useHouseholdStore.getState().load();
    expect(getSpy).toHaveBeenCalledTimes(2);
    getSpy.mockRestore();
  });
});
