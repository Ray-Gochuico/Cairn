import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { TickersRepo } from '@/domain/tickers';
import type { Ticker } from '@/types/schema';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const loadInitialMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0001_initial.sql'), 'utf-8');

const sampleTicker = (): Ticker => ({
  ticker: 'VTI',
  name: 'Vanguard Total Stock Market ETF',
  assetClass: 'US_TOTAL_MARKET',
  leverageFactor: 1.0,
  direction: 'LONG',
  userAdded: false,
});

describe('TickersRepo', () => {
  let db: SqliteAdapter;
  let repo: TickersRepo;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      { version: '0001_initial', sql: loadInitialMigration() },
    ]);
    repo = new TickersRepo(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('returns empty array on fresh schema', async () => {
    const all = await repo.list();
    expect(all).toEqual([]);
  });

  it('lookup returns null when no match', async () => {
    const result = await repo.lookup('NONEXISTENT');
    expect(result).toBeNull();
  });

  it('lookup returns parsed Ticker after upsert', async () => {
    await repo.upsert(sampleTicker());
    const found = await repo.lookup('VTI');
    expect(found).not.toBeNull();
    expect(found?.ticker).toBe('VTI');
    expect(found?.name).toBe('Vanguard Total Stock Market ETF');
    expect(found?.assetClass).toBe('US_TOTAL_MARKET');
    expect(found?.leverageFactor).toBe(1.0);
    expect(found?.direction).toBe('LONG');
    expect(found?.userAdded).toBe(false);
  });

  it('upsert inserts a new ticker and it appears in list()', async () => {
    await repo.upsert(sampleTicker());
    const all = await repo.list();
    expect(all).toHaveLength(1);
    expect(all[0].ticker).toBe('VTI');
  });

  it('upsert updates an existing ticker (replace path)', async () => {
    await repo.upsert(sampleTicker());
    await repo.upsert({ ...sampleTicker(), name: 'Updated Name', leverageFactor: 2.0 });
    const all = await repo.list();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('Updated Name');
    expect(all[0].leverageFactor).toBe(2.0);
  });

  it('delete removes the ticker', async () => {
    await repo.upsert(sampleTicker());
    await repo.delete('VTI');
    const all = await repo.list();
    expect(all).toEqual([]);
  });

  it('delete is a no-op for nonexistent ticker', async () => {
    await expect(repo.delete('NONEXISTENT')).resolves.toBeUndefined();
  });

  it('listUserAdded returns only user_added=true rows', async () => {
    const seedTicker: Ticker = { ...sampleTicker(), ticker: 'VTI', userAdded: false };
    const userAddedTicker: Ticker = {
      ticker: 'CUSTOM',
      name: 'Custom Fund',
      assetClass: 'OTHER',
      leverageFactor: 1.0,
      direction: 'LONG',
      userAdded: true,
    };

    await repo.upsert(seedTicker);
    await repo.upsert(userAddedTicker);

    const userAdded = await repo.listUserAdded();
    expect(userAdded).toHaveLength(1);
    expect(userAdded[0].ticker).toBe('CUSTOM');
    expect(userAdded[0].userAdded).toBe(true);
  });

  it('listUserAdded returns empty when no user-added tickers', async () => {
    await repo.upsert(sampleTicker());
    const userAdded = await repo.listUserAdded();
    expect(userAdded).toEqual([]);
  });

  it('upsert rejects invalid ticker schema', async () => {
    await expect(
      repo.upsert({
        ticker: '',
        name: null,
        assetClass: 'US_TOTAL_MARKET',
        leverageFactor: 1.0,
        direction: 'LONG',
        userAdded: false,
      })
    ).rejects.toThrow();
  });

  it('upsert handles nullable name', async () => {
    await repo.upsert({ ...sampleTicker(), name: null });
    const found = await repo.lookup('VTI');
    expect(found?.name).toBeNull();
  });
});
