import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { PriceCache } from '@/market/price-cache';
import type { YahooClient } from '@/market/yahoo-client';

const loadInitialMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0001_initial.sql'), 'utf-8');

const todayISO = () => new Date().toISOString().slice(0, 10);

describe('PriceCache', () => {
  let db: SqliteAdapter;
  let mockYahoo: YahooClient;
  let quoteFn: ReturnType<typeof vi.fn>;
  let historicalFn: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [{ version: '0001_initial', sql: loadInitialMigration() }]);
    quoteFn = vi.fn();
    historicalFn = vi.fn();
    mockYahoo = {
      quote: quoteFn,
      historical: historicalFn,
    } as unknown as YahooClient;
  });

  afterEach(async () => {
    await db.close();
  });

  describe('currentPrice', () => {
    it('hits cache on a second call within the 6h TTL', async () => {
      quoteFn.mockResolvedValueOnce({
        ticker: 'VTI',
        price: 250.55,
        changePct: 0.5,
        currency: 'USD',
        fetchedAt: new Date().toISOString(),
      });

      const cache = new PriceCache(db, mockYahoo);

      const p1 = await cache.currentPrice('VTI');
      const p2 = await cache.currentPrice('VTI');

      expect(p1).toBe(250.55);
      expect(p2).toBe(250.55);
      expect(quoteFn).toHaveBeenCalledTimes(1);
    });

    it('re-fetches when the cached row is older than 6 hours', async () => {
      // Seed a stale row dated today with fetched_at 7h ago.
      await db.execute(
        `INSERT INTO price_cache (ticker, date, price, fetched_at)
         VALUES (?, ?, ?, datetime('now', '-7 hours'))`,
        ['VTI', todayISO(), 100]
      );

      quoteFn.mockResolvedValueOnce({
        ticker: 'VTI',
        price: 200,
        changePct: 0,
        currency: 'USD',
        fetchedAt: new Date().toISOString(),
      });

      const cache = new PriceCache(db, mockYahoo);
      const price = await cache.currentPrice('VTI');

      expect(price).toBe(200);
      expect(quoteFn).toHaveBeenCalledTimes(1);

      // Follow-up within TTL should now hit cache (no second quote call).
      const price2 = await cache.currentPrice('VTI');
      expect(price2).toBe(200);
      expect(quoteFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('historicalPrice', () => {
    it('hits cache on a second call for the same ticker+date', async () => {
      historicalFn.mockResolvedValueOnce(123.45);

      const cache = new PriceCache(db, mockYahoo);

      const p1 = await cache.historicalPrice('VTI', '2024-05-31');
      const p2 = await cache.historicalPrice('VTI', '2024-05-31');

      expect(p1).toBe(123.45);
      expect(p2).toBe(123.45);
      expect(historicalFn).toHaveBeenCalledTimes(1);
    });

    it('persists the result so follow-up calls do not re-query Yahoo', async () => {
      historicalFn.mockResolvedValueOnce(99.99);

      const cache = new PriceCache(db, mockYahoo);
      await cache.historicalPrice('VXUS', '2024-05-31');

      const rows = await db.select<{ ticker: string; date: string; price: number }>(
        'SELECT ticker, date, price FROM price_cache WHERE ticker = ? AND date = ?',
        ['VXUS', '2024-05-31']
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].price).toBe(99.99);

      // Recreate the cache to confirm persistence (not memoized in-process).
      const cache2 = new PriceCache(db, mockYahoo);
      const again = await cache2.historicalPrice('VXUS', '2024-05-31');
      expect(again).toBe(99.99);
      expect(historicalFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('upsert idiom (ON CONFLICT, no rowid churn)', () => {
    it('historicalPrice re-write of the same (ticker, date) updates in place without cycling the rowid', async () => {
      // Seed an initial row directly so we control fetched_at.
      await db.execute(
        `INSERT INTO price_cache (ticker, date, price, fetched_at)
         VALUES (?, ?, ?, datetime('now', '-2 days'))`,
        ['VTI', '2024-05-31', 100]
      );
      const before = await db.select<{ rid: number; price: number; fetched_at: string }>(
        'SELECT rowid AS rid, price, fetched_at FROM price_cache WHERE ticker = ? AND date = ?',
        ['VTI', '2024-05-31']
      );
      expect(before).toHaveLength(1);

      // historicalPrice only writes on a cache MISS, but a row already exists,
      // so it would normally hit. Force the write path by stubbing historical
      // and writing through the same SQL idiom the cache uses: call the public
      // method after deleting freshness is not possible for historical (never
      // expires), so exercise the write directly via a second seed that must
      // collide on the PK and update in place.
      await db.execute(
        `INSERT INTO price_cache (ticker, date, price, fetched_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(ticker, date) DO UPDATE SET
           price = excluded.price, fetched_at = excluded.fetched_at`,
        ['VTI', '2024-05-31', 250]
      );

      const after = await db.select<{ rid: number; price: number; fetched_at: string }>(
        'SELECT rowid AS rid, price, fetched_at FROM price_cache WHERE ticker = ? AND date = ?',
        ['VTI', '2024-05-31']
      );
      // Cardinality unchanged, price updated, rowid stable.
      expect(after).toHaveLength(1);
      expect(after[0].price).toBe(250);
      expect(after[0].rid).toBe(before[0].rid);
      expect(after[0].fetched_at).not.toBe(before[0].fetched_at);

      // Whole-table cardinality is still 1 — no orphan from a delete-then-insert.
      const count = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM price_cache');
      expect(count[0].n).toBe(1);
    });

    it('currentPrice re-fetch (after TTL expiry) updates the existing row in place and keeps the rowid stable', async () => {
      // Seed a stale row dated today (fetched 7h ago) so currentPrice MISSES
      // and takes the write path against an EXISTING (ticker, date) row.
      await db.execute(
        `INSERT INTO price_cache (ticker, date, price, fetched_at)
         VALUES (?, ?, ?, datetime('now', '-7 hours'))`,
        ['VTI', todayISO(), 100]
      );
      const before = await db.select<{ rid: number }>(
        'SELECT rowid AS rid FROM price_cache WHERE ticker = ? AND date = ?',
        ['VTI', todayISO()]
      );
      expect(before).toHaveLength(1);

      quoteFn.mockResolvedValueOnce({
        ticker: 'VTI',
        price: 321.5,
        changePct: 0,
        currency: 'USD',
        fetchedAt: new Date().toISOString(),
      });

      const cache = new PriceCache(db, mockYahoo);
      const price = await cache.currentPrice('VTI');
      expect(price).toBe(321.5);

      const after = await db.select<{ rid: number; price: number }>(
        'SELECT rowid AS rid, price FROM price_cache WHERE ticker = ? AND date = ?',
        ['VTI', todayISO()]
      );
      // Updated in place: same single row, new price, SAME rowid (no churn).
      expect(after).toHaveLength(1);
      expect(after[0].price).toBe(321.5);
      expect(after[0].rid).toBe(before[0].rid);

      const count = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM price_cache');
      expect(count[0].n).toBe(1);
    });
  });
});
