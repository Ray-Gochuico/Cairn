import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { CategoriesRepo } from '@/domain/categories';

// Categories tests need the seed — run 0001 + 0008 + 0009.
const mig = (file: string) => ({
  version: file,
  sql: readFileSync(resolve(__dirname, `../../src/db/migrations/${file}.sql`), 'utf-8'),
});

describe('CategoriesRepo', () => {
  let db: SqliteAdapter;
  let repo: CategoriesRepo;
  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      mig('0001_initial'),
      mig('0008_add_transaction_property_links'),
      mig('0009_seed_categories'),
    ]);
    repo = new CategoriesRepo(db);
  });
  afterEach(async () => { await db.close(); });

  it('lists the 42 seeded categories', async () => {
    expect((await repo.list()).length).toBe(42);
  });

  it('creates and updates a user category', async () => {
    const id = await repo.create({
      name: 'Pet Care', parentCategoryId: null, color: null, icon: null,
      type: 'WANT', isCapital: false, systemManaged: false,
    });
    await repo.update(id, { name: 'Pets' });
    expect((await repo.findById(id))?.name).toBe('Pets');
  });

  it('deletes a user category', async () => {
    const id = await repo.create({
      name: 'Temp', parentCategoryId: null, color: null, icon: null,
      type: 'WANT', isCapital: false, systemManaged: false,
    });
    await repo.delete(id);
    expect(await repo.findById(id)).toBeNull();
  });

  it('refuses to delete a system-managed category', async () => {
    // id 41 = Transfer, seeded with system_managed = 1
    await expect(repo.delete(41)).rejects.toThrow();
    expect(await repo.findById(41)).not.toBeNull();
  });
});
