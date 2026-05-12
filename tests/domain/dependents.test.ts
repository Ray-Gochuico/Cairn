import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { DependentsRepo } from '@/domain/dependents';
import { DependentType } from '@/types/enums';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const loadInitialMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0001_initial.sql'), 'utf-8');

describe('DependentsRepo', () => {
  let db: SqliteAdapter;
  let repo: DependentsRepo;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [{ version: '0001_initial', sql: loadInitialMigration() }]);
    repo = new DependentsRepo(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('lists dependents (empty initially)', async () => {
    expect(await repo.list()).toEqual([]);
  });

  it('creates, updates, and deletes a dependent', async () => {
    const id = await repo.create({
      householdId: 1,
      name: 'Riley',
      dateOfBirth: '2018-06-10',
      type: DependentType.CHILD,
    });
    expect(id).toBeGreaterThan(0);

    let all = await repo.list();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('Riley');
    expect(all[0].type).toBe(DependentType.CHILD);

    await repo.update(id, { name: 'Riley K.' });
    all = await repo.list();
    expect(all[0].name).toBe('Riley K.');

    await repo.delete(id);
    expect(await repo.list()).toEqual([]);
  });
});
