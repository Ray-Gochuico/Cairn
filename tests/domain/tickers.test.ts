import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { TickersRepo } from '@/domain/tickers';
import type { Ticker } from '@/types/schema';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const loadInitialMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0001_initial.sql'), 'utf-8');

const loadSeedTickersMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0006_seed_tickers.sql'), 'utf-8');

const loadAccentColorsMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0015_add_accent_colors.sql'), 'utf-8');

const loadSectorIndustryMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0016_add_ticker_sector_industry.sql'), 'utf-8');

const sampleTicker = (): Ticker => ({
  ticker: 'VTI',
  name: 'Vanguard Total Stock Market ETF',
  assetClass: 'US_TOTAL_MARKET',
  leverageFactor: 1.0,
  direction: 'LONG',
  userAdded: false,
  accentColor: null,
  sector: null,
  industry: null,
});

describe('TickersRepo', () => {
  let db: SqliteAdapter;
  let repo: TickersRepo;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      { version: '0001_initial', sql: loadInitialMigration() },
      { version: '0015_add_accent_colors', sql: loadAccentColorsMigration() },
      { version: '0016_add_ticker_sector_industry', sql: loadSectorIndustryMigration() },
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
      accentColor: null,
      sector: null,
      industry: null,
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
        accentColor: null,
        sector: null,
        industry: null,
      })
    ).rejects.toThrow();
  });

  it('upsert handles nullable name', async () => {
    await repo.upsert({ ...sampleTicker(), name: null });
    const found = await repo.lookup('VTI');
    expect(found?.name).toBeNull();
  });

  it('round-trips accentColor through upsert', async () => {
    await repo.upsert({ ...sampleTicker(), accentColor: '#f58518' });
    expect((await repo.lookup('VTI'))?.accentColor).toBe('#f58518');
  });

  it('setAccentColor changes only the color column', async () => {
    await repo.upsert(sampleTicker());
    await repo.setAccentColor('VTI', '#54a24b');
    const t = await repo.lookup('VTI');
    expect(t?.accentColor).toBe('#54a24b');
    expect(t?.name).toBe('Vanguard Total Stock Market ETF'); // unchanged
    expect(t?.assetClass).toBe('US_TOTAL_MARKET'); // unchanged
    await repo.setAccentColor('VTI', null);
    expect((await repo.lookup('VTI'))?.accentColor).toBeNull();
  });

  it('round-trips sector and industry through upsert', async () => {
    await repo.upsert({
      ...sampleTicker(),
      sector: 'Technology',
      industry: 'Software—Infrastructure',
    });
    const found = await repo.lookup('VTI');
    expect(found?.sector).toBe('Technology');
    expect(found?.industry).toBe('Software—Infrastructure');
  });

  it('round-trips null sector and industry through upsert', async () => {
    await repo.upsert({
      ...sampleTicker(),
      sector: 'Technology',
      industry: 'Software',
    });
    // Now clear them.
    await repo.upsert({ ...sampleTicker(), sector: null, industry: null });
    const found = await repo.lookup('VTI');
    expect(found?.sector).toBeNull();
    expect(found?.industry).toBeNull();
  });
});

describe('TickersRepo with seed migration', () => {
  let db: SqliteAdapter;
  let repo: TickersRepo;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      { version: '0001_initial', sql: loadInitialMigration() },
      { version: '0006_seed_tickers', sql: loadSeedTickersMigration() },
      { version: '0015_add_accent_colors', sql: loadAccentColorsMigration() },
      { version: '0016_add_ticker_sector_industry', sql: loadSectorIndustryMigration() },
    ]);
    repo = new TickersRepo(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('seeds VTI as US_TOTAL_MARKET', async () => {
    const t = await repo.lookup('VTI');
    expect(t).not.toBeNull();
    expect(t!.assetClass).toBe('US_TOTAL_MARKET');
    expect(t!.leverageFactor).toBe(1.0);
  });

  it('seeds TQQQ as US_LARGE_CAP with leverage 3x', async () => {
    const t = await repo.lookup('TQQQ');
    expect(t!.leverageFactor).toBe(3.0);
    expect(t!.direction).toBe('LONG');
  });

  it('seeds BTC-USD as CRYPTO', async () => {
    const t = await repo.lookup('BTC-USD');
    expect(t!.assetClass).toBe('CRYPTO');
  });

  it('seeds SPY as US_LARGE_CAP with userAdded false', async () => {
    const t = await repo.lookup('SPY');
    expect(t).not.toBeNull();
    expect(t!.assetClass).toBe('US_LARGE_CAP');
    expect(t!.userAdded).toBe(false);
  });

  it('seeds BND as US_BONDS with userAdded false', async () => {
    const t = await repo.lookup('BND');
    expect(t).not.toBeNull();
    expect(t!.assetClass).toBe('US_BONDS');
    expect(t!.userAdded).toBe(false);
  });

  it('seeds AAPL as SINGLE_STOCK with userAdded false', async () => {
    const t = await repo.lookup('AAPL');
    expect(t).not.toBeNull();
    expect(t!.assetClass).toBe('SINGLE_STOCK');
    expect(t!.leverageFactor).toBe(1.0);
    expect(t!.userAdded).toBe(false);
  });

  it('seeds SQQQ as SHORT direction', async () => {
    const t = await repo.lookup('SQQQ');
    expect(t).not.toBeNull();
    expect(t!.direction).toBe('SHORT');
  });

  it('seeds GLD as COMMODITIES', async () => {
    const t = await repo.lookup('GLD');
    expect(t).not.toBeNull();
    expect(t!.assetClass).toBe('COMMODITIES');
  });

  it('list() returns at least 150 rows from seed', async () => {
    const all = await repo.list();
    expect(all.length).toBeGreaterThanOrEqual(150);
  });

  it('seed is idempotent (running migration twice does not throw)', async () => {
    const sql = loadSeedTickersMigration();
    await expect(
      runMigrations(db, [{ version: '0006_seed_tickers_dup', sql }])
    ).resolves.not.toThrow();
    const all = await repo.list();
    expect(all.length).toBeGreaterThanOrEqual(150);
  });
});
