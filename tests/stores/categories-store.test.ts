import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useCategoriesStore } from '@/stores/categories-store';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mig = (file: string) => ({
  version: file,
  sql: readFileSync(resolve(__dirname, `../../src/db/migrations/${file}.sql`), 'utf-8'),
});

describe('useCategoriesStore', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      mig('0001_initial'),
      mig('0008_add_transaction_property_links'),
      mig('0009_seed_categories'),
      mig('0013_add_category_budget'),
    ]);
    setDatabase(db);
    useCategoriesStore.setState({ categories: [], isLoading: false, error: null });
  });

  afterEach(async () => {
    await db.close();
  });

  it('load() populates the 42 seeded categories', async () => {
    await useCategoriesStore.getState().load();
    const { categories, isLoading, error } = useCategoriesStore.getState();
    expect(categories).toHaveLength(42);
    expect(isLoading).toBe(false);
    expect(error).toBeNull();
  });

  it('create() adds a category and refreshes the cache', async () => {
    await useCategoriesStore.getState().load();
    const id = await useCategoriesStore.getState().create({
      name: 'Pet Care',
      parentCategoryId: null,
      color: null,
      icon: null,
      type: 'WANT',
      isCapital: false,
      systemManaged: false,
      monthlyBudget: null,
    });
    expect(id).toBeGreaterThan(0);
    const { categories } = useCategoriesStore.getState();
    expect(categories).toHaveLength(43);
    expect(categories.find((c) => c.id === id)?.name).toBe('Pet Care');
  });
});
