import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { MerchantOverridesRepo } from '@/domain/merchant-overrides';
import { MerchantSeedRepo } from '@/domain/merchant-seed';

const mig = (file: string) => ({
  version: file,
  sql: readFileSync(resolve(__dirname, `../../src/db/migrations/${file}.sql`), 'utf-8'),
});

describe('merchant repos', () => {
  let db: SqliteAdapter;
  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      mig('0001_initial'),
      mig('0008_add_transaction_property_links'),
      mig('0009_seed_categories'),
      mig('0010_seed_merchant_mappings'),
    ]);
  });
  afterEach(async () => { await db.close(); });

  it('MerchantSeedRepo lists the seeded mappings', async () => {
    const seeds = await new MerchantSeedRepo(db).list();
    expect(seeds.length).toBeGreaterThanOrEqual(200);
  });

  it('MerchantOverridesRepo create + list', async () => {
    const repo = new MerchantOverridesRepo(db);
    await repo.create({ householdId: 1, merchantPattern: 'BLUE BOTTLE', categoryId: 32 });
    const list = await repo.list();
    expect(list).toHaveLength(1);
    expect(list[0].merchantPattern).toBe('BLUE BOTTLE');
  });

  it('upsertForMerchant repoints an existing pattern instead of duplicating', async () => {
    const repo = new MerchantOverridesRepo(db);
    await repo.upsertForMerchant(1, 'BLUE BOTTLE', 32);
    await repo.upsertForMerchant(1, 'BLUE BOTTLE', 25);
    const list = await repo.list();
    expect(list).toHaveLength(1);
    expect(list[0].categoryId).toBe(25);
  });
});
