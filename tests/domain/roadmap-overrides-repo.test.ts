import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { RoadmapOverridesRepo } from '@/domain/roadmap-overrides-repo';

describe('RoadmapOverridesRepo', () => {
  let db: SqliteAdapter;
  let repo: RoadmapOverridesRepo;

  beforeEach(async () => {
    db = new SqliteAdapter();
    await runMigrations(db, await loadAllMigrations());
    repo = new RoadmapOverridesRepo(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('starts empty', async () => {
    expect(await repo.list()).toEqual([]);
  });

  it('upsert inserts a new override', async () => {
    await repo.upsert({
      householdId: 1,
      nodeId: 's0_create_budget',
      overrideStatus: 'done',
      note: 'I track in YNAB',
    });
    const all = await repo.list();
    expect(all).toHaveLength(1);
    expect(all[0].nodeId).toBe('s0_create_budget');
    expect(all[0].overrideStatus).toBe('done');
    expect(all[0].note).toBe('I track in YNAB');
  });

  it('upsert replaces an existing override for the same (household, node)', async () => {
    await repo.upsert({
      householdId: 1, nodeId: 's0_create_budget', overrideStatus: 'done', note: 'first',
    });
    await repo.upsert({
      householdId: 1, nodeId: 's0_create_budget', overrideStatus: 'skipped', note: 'second',
    });
    const all = await repo.list();
    expect(all).toHaveLength(1);
    expect(all[0].overrideStatus).toBe('skipped');
    expect(all[0].note).toBe('second');
  });

  it('upsert keeps overrides for different nodes independent', async () => {
    await repo.upsert({ householdId: 1, nodeId: 's0_create_budget', overrideStatus: 'done' });
    await repo.upsert({ householdId: 1, nodeId: 's1_emergency_small', overrideStatus: 'skipped' });
    const all = await repo.list();
    expect(all).toHaveLength(2);
  });

  it('upsert accepts a null note', async () => {
    await repo.upsert({ householdId: 1, nodeId: 's0_create_budget', overrideStatus: 'done' });
    const all = await repo.list();
    expect(all[0].note).toBeNull();
  });

  it('delete removes the matching override', async () => {
    await repo.upsert({ householdId: 1, nodeId: 's0_create_budget', overrideStatus: 'done' });
    await repo.delete(1, 's0_create_budget');
    expect(await repo.list()).toEqual([]);
  });

  it('delete is a no-op when no override exists', async () => {
    await repo.delete(1, 's0_create_budget');
    expect(await repo.list()).toEqual([]);
  });

  it('list orders most-recent first by set_at', async () => {
    await repo.upsert({ householdId: 1, nodeId: 's0_create_budget', overrideStatus: 'done' });
    // Force a small clock gap so set_at differs.
    await new Promise((r) => setTimeout(r, 5));
    await repo.upsert({ householdId: 1, nodeId: 's1_emergency_small', overrideStatus: 'skipped' });
    const all = await repo.list();
    expect(all[0].nodeId).toBe('s1_emergency_small');
    expect(all[1].nodeId).toBe('s0_create_budget');
  });
});
