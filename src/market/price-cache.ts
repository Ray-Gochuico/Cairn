import type { Database } from '@/db/db';
import type { YahooClient } from './yahoo-client';

export interface PriceCacheAPI {
  /**
   * Returns the close price for `ticker` on `date` (YYYY-MM-DD).
   * Hits the cache first; on miss, queries Yahoo, persists, returns.
   * Historical prices never expire — once the market closed for a day,
   * the close price is final.
   */
  historicalPrice(ticker: string, date: string): Promise<number>;

  /**
   * Returns the most recent price for `ticker`. Cache TTL = 6 hours;
   * older rows are treated as a miss and re-fetched from Yahoo.
   */
  currentPrice(ticker: string): Promise<number>;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export class PriceCache implements PriceCacheAPI {
  constructor(private db: Database, private yahoo: YahooClient) {}

  async historicalPrice(ticker: string, date: string): Promise<number> {
    const hit = await this.db.select<{ price: number }>(
      'SELECT price FROM price_cache WHERE ticker = ? AND date = ?',
      [ticker, date]
    );
    if (hit.length > 0) return hit[0].price;

    const price = await this.yahoo.historical(ticker, date);
    // ON CONFLICT … DO UPDATE (not INSERT OR REPLACE) so a re-write of an
    // existing (ticker, date) updates the row in place. INSERT OR REPLACE
    // deletes-then-inserts and cycles the implicit rowid — the same idiom
    // rule snapshots.ts follows. (ticker, date) is the table PK.
    await this.db.execute(
      `INSERT INTO price_cache (ticker, date, price, fetched_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(ticker, date) DO UPDATE SET
         price = excluded.price,
         fetched_at = excluded.fetched_at`,
      [ticker, date, price]
    );
    return price;
  }

  async currentPrice(ticker: string): Promise<number> {
    const today = todayISO();
    // Freshness check is done in SQL — let SQLite handle the time math
    // against fetched_at's text default (YYYY-MM-DD HH:MM:SS).
    const hit = await this.db.select<{ price: number }>(
      `SELECT price FROM price_cache
       WHERE ticker = ? AND date = ?
         AND fetched_at >= datetime('now', '-6 hours')`,
      [ticker, today]
    );
    if (hit.length > 0) return hit[0].price;

    const quote = await this.yahoo.quote(ticker);
    // ON CONFLICT … DO UPDATE (not INSERT OR REPLACE): a same-day re-fetch
    // after the 6h TTL updates the existing (ticker, date) row in place
    // rather than delete-then-insert (which cycles the implicit rowid).
    // Mirrors snapshots.ts; (ticker, date) is the table PK.
    await this.db.execute(
      `INSERT INTO price_cache (ticker, date, price, fetched_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(ticker, date) DO UPDATE SET
         price = excluded.price,
         fetched_at = excluded.fetched_at`,
      [ticker, today, quote.price]
    );
    return quote.price;
  }
}
