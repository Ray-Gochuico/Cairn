import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useScenariosStore } from '@/stores/scenarios-store';
import { emptyLeverPayload } from '@/lib/scenarios';

const resetStore = () => {
  useScenariosStore.setState({
    scenarios: [],
    isLoading: false,
    error: null,
    horizonMonths: 360,
    dollarMode: 'nominal',
    inflation: 0.025,
    defaultReturnRate: 0.07,
    projectionCache: new Map(),
  });
};

describe('useScenariosStore — load + baseline auto-creation', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter();
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    resetStore();
  });

  afterEach(async () => { await db.close(); });

  it('initial in-memory state has the documented defaults', () => {
    const s = useScenariosStore.getState();
    expect(s.scenarios).toEqual([]);
    expect(s.isLoading).toBe(false);
    expect(s.error).toBeNull();
    expect(s.horizonMonths).toBe(360);
    expect(s.dollarMode).toBe('nominal');
    expect(s.inflation).toBeCloseTo(0.025, 4);
    expect(s.defaultReturnRate).toBeCloseTo(0.07, 4);
  });

  it('load() against an empty table auto-creates a baseline scenario', async () => {
    await useScenariosStore.getState().load();
    const { scenarios, error } = useScenariosStore.getState();
    expect(error).toBeNull();
    expect(scenarios).toHaveLength(1);
    expect(scenarios[0].isBaseline).toBe(true);
    expect(scenarios[0].isActive).toBe(true);
    expect(scenarios[0].name).toBe('Baseline');
    expect(scenarios[0].color).toBe('#4f86f7');
    expect(scenarios[0].leverPayload).toEqual(emptyLeverPayload());
  });

  it('load() against a populated table does NOT create a second baseline', async () => {
    await useScenariosStore.getState().load();
    await useScenariosStore.getState().load();
    const { scenarios } = useScenariosStore.getState();
    expect(scenarios.filter((s) => s.isBaseline)).toHaveLength(1);
  });

  it('load() writes DB errors into state.error and does not throw', async () => {
    await db.close();
    await useScenariosStore.getState().load();
    expect(useScenariosStore.getState().error).toBeTruthy();
    expect(useScenariosStore.getState().scenarios).toEqual([]);
  });
});
