import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { GoalsRepo } from '@/domain/goals';
import { GoalType } from '@/types/enums';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const loadInitialMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0001_initial.sql'), 'utf-8');

const makeGoal = async (
  repo: GoalsRepo,
  overrides: Partial<Parameters<GoalsRepo['create']>[0]> = {}
): Promise<number> => {
  return repo.create({
    householdId: 1,
    forPersonId: null,
    name: 'Emergency Fund',
    type: GoalType.EMERGENCY_FUND,
    targetAmount: 30000,
    targetDate: '2027-12-31',
    linkedAccountIds: [],
    ...overrides,
  });
};

describe('GoalsRepo', () => {
  let db: SqliteAdapter;
  let repo: GoalsRepo;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [{ version: '0001_initial', sql: loadInitialMigration() }]);
    repo = new GoalsRepo(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('returns empty array when no goals exist', async () => {
    expect(await repo.list()).toEqual([]);
  });

  it('creates a goal and returns its id', async () => {
    const id = await makeGoal(repo);
    expect(id).toBeGreaterThan(0);
  });

  it('lists goals in id order', async () => {
    const a = await makeGoal(repo, { name: 'Goal A' });
    const b = await makeGoal(repo, { name: 'Goal B', type: GoalType.RETIREMENT });
    const c = await makeGoal(repo, { name: 'Goal C', type: GoalType.DOWN_PAYMENT });

    const all = await repo.list();
    expect(all).toHaveLength(3);
    expect(all.map((g) => g.id)).toEqual([a, b, c]);
    expect(all.map((g) => g.name)).toEqual(['Goal A', 'Goal B', 'Goal C']);
    expect(all[1].type).toBe(GoalType.RETIREMENT);
    expect(all[2].type).toBe(GoalType.DOWN_PAYMENT);
  });

  it('finds a goal by id', async () => {
    const id = await makeGoal(repo, {
      name: 'College Fund',
      type: GoalType.EDUCATION,
      targetAmount: 80000,
      targetDate: '2035-08-15',
    });
    const found = await repo.findById(id);
    expect(found).not.toBeNull();
    expect(found?.name).toBe('College Fund');
    expect(found?.type).toBe(GoalType.EDUCATION);
    expect(found?.targetAmount).toBe(80000);
    expect(found?.targetDate).toBe('2035-08-15');
  });

  it('returns null from findById for unknown id', async () => {
    expect(await repo.findById(999)).toBeNull();
  });

  it('updates a goal including swapping linkedAccountIds', async () => {
    const id = await makeGoal(repo, { linkedAccountIds: [1, 2] });
    await repo.update(id, {
      targetAmount: 50000,
      linkedAccountIds: [3, 4, 5],
    });

    const updated = await repo.findById(id);
    expect(updated?.targetAmount).toBe(50000);
    expect(updated?.linkedAccountIds).toEqual([3, 4, 5]);
    expect(updated?.name).toBe('Emergency Fund');             // unchanged
    expect(updated?.type).toBe(GoalType.EMERGENCY_FUND);     // unchanged
  });

  it('updates linkedAccountIds to empty array', async () => {
    const id = await makeGoal(repo, { linkedAccountIds: [10, 20, 30] });
    await repo.update(id, { linkedAccountIds: [] });

    const updated = await repo.findById(id);
    expect(updated?.linkedAccountIds).toEqual([]);
  });

  it('deletes a goal', async () => {
    const id = await makeGoal(repo);
    await repo.delete(id);
    expect(await repo.list()).toEqual([]);
    expect(await repo.findById(id)).toBeNull();
  });

  it('round-trips an empty linkedAccountIds array', async () => {
    const id = await makeGoal(repo, { linkedAccountIds: [] });
    const found = await repo.findById(id);
    expect(found?.linkedAccountIds).toEqual([]);
  });

  it('round-trips a multi-element linkedAccountIds array', async () => {
    const ids = [101, 202, 303, 404];
    const id = await makeGoal(repo, { linkedAccountIds: ids });
    const found = await repo.findById(id);
    expect(found?.linkedAccountIds).toEqual(ids);

    // Verify list() round-trips it identically
    const all = await repo.list();
    expect(all[0].linkedAccountIds).toEqual(ids);
  });

  it('rejects invalid type enum value on create', async () => {
    await expect(
      makeGoal(repo, {
        // @ts-expect-error testing runtime validation
        type: 'NOT_A_GOAL_TYPE',
      })
    ).rejects.toThrow();
  });

  it('rejects negative targetAmount', async () => {
    await expect(
      makeGoal(repo, { targetAmount: -1 })
    ).rejects.toThrow();
  });
});
