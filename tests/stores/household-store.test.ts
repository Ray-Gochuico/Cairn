import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useHouseholdStore } from '@/stores/household-store';
import { FilingStatus } from '@/types/enums';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const loadInitialMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0001_initial.sql'), 'utf-8');

describe('useHouseholdStore', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [{ version: '0001_initial', sql: loadInitialMigration() }]);
    setDatabase(db);
    useHouseholdStore.setState({ household: null, isLoading: false, error: null });
  });

  afterEach(async () => {
    await db.close();
  });

  it('loads the household from the database', async () => {
    await useHouseholdStore.getState().load();
    const { household } = useHouseholdStore.getState();
    expect(household).not.toBeNull();
    expect(household!.filingStatus).toBe(FilingStatus.SINGLE);
  });

  it('updates the household and refreshes state', async () => {
    await useHouseholdStore.getState().load();
    await useHouseholdStore.getState().update({
      filingStatus: FilingStatus.MFJ,
      state: 'WA',
      monthlyExpenseBaseline: 7000,
    });
    const { household } = useHouseholdStore.getState();
    expect(household!.filingStatus).toBe(FilingStatus.MFJ);
    expect(household!.state).toBe('WA');
    expect(household!.monthlyExpenseBaseline).toBe(7000);
  });

  it('sets error state on invalid update', async () => {
    await useHouseholdStore.getState().load();
    try {
      await useHouseholdStore.getState().update({ withdrawalRate: 5.0 } as any);
    } catch {
      /* expected */
    }
    const { error } = useHouseholdStore.getState();
    expect(error).not.toBeNull();
  });
});
