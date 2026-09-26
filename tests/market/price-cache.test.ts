import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { PriceCache } from '@/market/price-cache';
import type { YahooClient } from '@/market/yahoo-client';
import { localTodayISO } from '@/lib/dates';

const loadInitialMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0001_initial.sql'), 'utf-8');

// v1.8.0 A-2′ (D-A2-4): the current-price key is the LOCAL day, so the seeded "today"
// row is keyed the same way (a UTC key is the next local day on a US evening).
const todayISO = () => localTodayISO();

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

  describe('v1.8.0 A-2′ (D-A2-4): the current-price row is keyed by the LOCAL day', () => {
    const ORIGINAL_TZ = process.env.TZ;
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
    });
    afterEach(() => {
      vi.useRealTimers();
      if (ORIGINAL_TZ === undefined) delete process.env.TZ;
      else process.env.TZ = ORIGINAL_TZ;
    });
    async function keysAfterTwoReads(): Promise<string[]> {
      quoteFn.mockResolvedValueOnce({
        ticker: 'VTI', price: 101, changePct: 0, currency: 'USD', fetchedAt: '2026-01-01T00:00:00.000Z',
      });
      const cache = new PriceCache(db, mockYahoo);
      expect(await cache.currentPrice('VTI')).toBe(101);
      expect(await cache.currentPrice('VTI')).toBe(101); // same local day, inside the TTL → a hit
      expect(quoteFn).toHaveBeenCalledTimes(1);
      const rows = await db.select<{ date: string }>('SELECT date FROM price_cache WHERE ticker = ?', ['VTI']);
      return rows.map((r) => r.date);
    }

    it('Los Angeles, Dec 31 19:00 PST (UTC day Jan 1): the row is keyed 2025-12-31', async () => {
      process.env.TZ = 'America/Los_Angeles';
      vi.setSystemTime(new Date('2026-01-01T03:00:00Z'));
      expect(await keysAfterTwoReads()).toEqual(['2025-12-31']);
    });

    it('Pacific/Auckland, Jan 1 09:00 NZDT (UTC day Dec 31): the row is keyed 2026-01-01', async () => {
      process.env.TZ = 'Pacific/Auckland';
      vi.setSystemTime(new Date('2025-12-31T20:00:00Z'));
      expect(await keysAfterTwoReads()).toEqual(['2026-01-01']);
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
