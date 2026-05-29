import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { FundHoldingsRepo } from '@/domain/fund-holdings';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const loadMigration = (file: string) =>
  readFileSync(resolve(__dirname, `../../src/db/migrations/${file}`), 'utf-8');

describe('FundHoldingsRepo', () => {
  let db: SqliteAdapter;
  let repo: FundHoldingsRepo;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      { version: '0001_initial', sql: loadMigration('0001_initial.sql') },
      // 0041 adds fund_holdings.holding_name, which upsertHoldings now writes.
      { version: '0041_fund_holding_names', sql: loadMigration('0041_fund_holding_names.sql') },
    ]);
    repo = new FundHoldingsRepo(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('listForFund returns empty for unknown fund', async () => {
    const result = await repo.listForFund('VTI');
    expect(result).toEqual([]);
  });

  it('upsertHoldings replaces previous rows for that fund and inserts new rows', async () => {
    await repo.upsertHoldings(
      'VTI',
      [
        { symbol: 'AAPL', weight: 0.06 },
        { symbol: 'MSFT', weight: 0.05 },
      ],
      '2025-01-15'
    );
    const holdings = await repo.listForFund('VTI');
    expect(holdings).toHaveLength(2);
    const tickers = holdings.map((h) => h.holdingTicker).sort();
    expect(tickers).toEqual(['AAPL', 'MSFT']);
    expect(holdings[0].fundTicker).toBe('VTI');
    expect(holdings[0].asOfDate).toBe('2025-01-15');
  });

  it('upsertHoldings persists holdingName and listForFund returns it', async () => {
    await repo.upsertHoldings(
      'VTI',
      [
        { symbol: 'AAPL', weight: 0.06, name: 'Apple Inc' },
        // Omitted name defaults to null (Yahoo occasionally drops holdingName).
        { symbol: 'MSFT', weight: 0.05 },
      ],
      '2025-01-15'
    );
    const holdings = await repo.listForFund('VTI');
    const byTicker = Object.fromEntries(holdings.map((h) => [h.holdingTicker, h.holdingName]));
    expect(byTicker.AAPL).toBe('Apple Inc');
    expect(byTicker.MSFT).toBeNull();
  });

  it('upsertHoldings overwrites stale entries when called again (replace semantics)', async () => {
    await repo.upsertHoldings(
      'VTI',
      [
        { symbol: 'AAPL', weight: 0.06 },
        { symbol: 'MSFT', weight: 0.05 },
      ],
      '2025-01-15'
    );
    // Second upsert with a different holding set and newer date
    await repo.upsertHoldings(
      'VTI',
      [{ symbol: 'NVDA', weight: 0.07 }],
      '2025-02-01'
    );
    const holdings = await repo.listForFund('VTI');
    expect(holdings).toHaveLength(1);
    expect(holdings[0].holdingTicker).toBe('NVDA');
    expect(holdings[0].asOfDate).toBe('2025-02-01');
  });

  it('getAsOf returns null for fund with no rows', async () => {
    const result = await repo.getAsOf('SPY');
    expect(result).toBeNull();
  });

  it('getAsOf returns max as_of_date for fund', async () => {
    await repo.upsertHoldings(
      'SPY',
      [{ symbol: 'AAPL', weight: 0.07 }],
      '2025-03-01'
    );
    const result = await repo.getAsOf('SPY');
    expect(result).toBe('2025-03-01');
  });

  it('isStale returns true when as_of_date < today - 90d', async () => {
    // Insert data from 200 days ago
    const oldDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    await repo.upsertHoldings('QQQ', [{ symbol: 'AAPL', weight: 0.1 }], oldDate);
    const today = new Date();
    const stale = await repo.isStale('QQQ', today, 90);
    expect(stale).toBe(true);
  });

  it('isStale returns false when as_of_date is recent', async () => {
    // Insert data from 10 days ago
    const recentDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    await repo.upsertHoldings('QQQ', [{ symbol: 'AAPL', weight: 0.1 }], recentDate);
    const today = new Date();
    const stale = await repo.isStale('QQQ', today, 90);
    expect(stale).toBe(false);
  });

  it('isStale returns true when fund has no rows at all (treated as fully stale)', async () => {
    const today = new Date();
    const stale = await repo.isStale('NONEXISTENT', today, 90);
    expect(stale).toBe(true);
  });
});
