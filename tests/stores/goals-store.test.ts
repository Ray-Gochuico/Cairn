import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useGoalsStore } from '@/stores/goals-store';
import { GoalType } from '@/types/enums';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const loadInitialMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0001_initial.sql'), 'utf-8');

const sampleGoal = {
  householdId: 1,
  forPersonId: null,
  name: 'Emergency Fund',
  type: GoalType.EMERGENCY_FUND,
  targetAmount: 30000,
  targetDate: '2027-12-31',
  linkedAccountIds: [],
};

describe('useGoalsStore', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [{ version: '0001_initial', sql: loadInitialMigration() }]);
    setDatabase(db);
    useGoalsStore.setState({ goals: [], isLoading: false, error: null });
  });

  afterEach(async () => {
    await db.close();
  });

  it('initial state is empty with no loading and no error', () => {
    const { goals, isLoading, error } = useGoalsStore.getState();
    expect(goals).toEqual([]);
    expect(isLoading).toBe(false);
    expect(error).toBeNull();
  });

  it('load() populates goals from the database', async () => {
    // Seed directly via DB so we don't depend on the store's create path
    await db.execute(
      `INSERT INTO goals (
        household_id, for_person_id, name, type,
        target_amount, target_date, linked_account_ids
      ) VALUES (1, NULL, 'Seeded Goal', 'RETIREMENT', 1000000, '2055-01-01', '[]')`
    );

    await useGoalsStore.getState().load();
    const { goals, isLoading, error } = useGoalsStore.getState();
    expect(goals).toHaveLength(1);
    expect(goals[0].name).toBe('Seeded Goal');
    expect(goals[0].type).toBe(GoalType.RETIREMENT);
    expect(isLoading).toBe(false);
    expect(error).toBeNull();
  });

  it('create() persists the goal and refreshes the in-memory cache', async () => {
    const id = await useGoalsStore.getState().create(sampleGoal);
    expect(id).toBeGreaterThan(0);

    const { goals } = useGoalsStore.getState();
    expect(goals).toHaveLength(1);
    expect(goals[0].id).toBe(id);
    expect(goals[0].name).toBe('Emergency Fund');
    expect(goals[0].type).toBe(GoalType.EMERGENCY_FUND);
    expect(goals[0].targetAmount).toBe(30000);
  });

  it('update() mutates persisted fields and refreshes', async () => {
    const id = await useGoalsStore.getState().create(sampleGoal);

    await useGoalsStore.getState().update(id, {
      name: 'Bigger Emergency Fund',
      targetAmount: 50000,
    });

    const { goals } = useGoalsStore.getState();
    expect(goals).toHaveLength(1);
    expect(goals[0].name).toBe('Bigger Emergency Fund');
    expect(goals[0].targetAmount).toBe(50000);
    expect(goals[0].targetDate).toBe('2027-12-31'); // unchanged
    expect(goals[0].type).toBe(GoalType.EMERGENCY_FUND); // unchanged
  });

  it('remove() deletes the goal and refreshes', async () => {
    const id = await useGoalsStore.getState().create(sampleGoal);
    expect(useGoalsStore.getState().goals).toHaveLength(1);

    await useGoalsStore.getState().remove(id);
    expect(useGoalsStore.getState().goals).toEqual([]);
  });

  it('load() swallows DB errors into state.error (does NOT rethrow)', async () => {
    // Close the underlying DB so subsequent operations fail
    await db.close();

    // load() must not rethrow — it should set error on state
    await expect(useGoalsStore.getState().load()).resolves.toBeUndefined();

    const { error, isLoading } = useGoalsStore.getState();
    expect(error).not.toBeNull();
    expect(isLoading).toBe(false);
  });

  it('create() rethrows on validation failure', async () => {
    await expect(
      useGoalsStore.getState().create({
        ...sampleGoal,
        name: '', // schema requires min(1)
      })
    ).rejects.toThrow();
  });
});
