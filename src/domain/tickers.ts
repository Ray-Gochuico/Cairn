import type { z } from 'zod';
import type { Database } from '@/db/db';
import { TickerSchema, type Ticker } from '@/types/schema';

interface TickerRow {
  ticker: string;
  name: string | null;
  asset_class: string;
  leverage_factor: number;
  direction: string;
  user_added: number;
  accent_color: string | null;
  sector: string | null;
  industry: string | null;
  fifty_two_week_low: number | null;
  fifty_two_week_high: number | null;
  regular_market_change: number | null;
  regular_market_previous_close: number | null;
}

function rowToTicker(row: TickerRow): Ticker {
  return TickerSchema.parse({
    ticker: row.ticker,
    name: row.name,
    assetClass: row.asset_class,
    leverageFactor: row.leverage_factor,
    direction: row.direction,
    userAdded: row.user_added === 1,
    accentColor: row.accent_color ?? null,
    sector: row.sector ?? null,
    industry: row.industry ?? null,
    fiftyTwoWeekLow: row.fifty_two_week_low ?? null,
    fiftyTwoWeekHigh: row.fifty_two_week_high ?? null,
    regularMarketChange: row.regular_market_change ?? null,
    regularMarketPreviousClose: row.regular_market_previous_close ?? null,
  });
}

export class TickersRepo {
  constructor(private db: Database) {}

  async list(): Promise<Ticker[]> {
    const rows = await this.db.select<TickerRow>(
      'SELECT * FROM tickers ORDER BY ticker ASC'
    );
    return rows.map(rowToTicker);
  }

  async lookup(ticker: string): Promise<Ticker | null> {
    const rows = await this.db.select<TickerRow>(
      'SELECT * FROM tickers WHERE ticker = ? LIMIT 1',
      [ticker]
    );
    return rows.length > 0 ? rowToTicker(rows[0]) : null;
  }

  async upsert(ticker: z.input<typeof TickerSchema>): Promise<void> {
    const parsed = TickerSchema.parse(ticker);
    await this.db.execute(
      `INSERT OR REPLACE INTO tickers (ticker, name, asset_class, leverage_factor, direction, user_added, accent_color, sector, industry, fifty_two_week_low, fifty_two_week_high, regular_market_change, regular_market_previous_close)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        parsed.ticker,
        parsed.name,
        parsed.assetClass,
        parsed.leverageFactor,
        parsed.direction,
        parsed.userAdded ? 1 : 0,
        parsed.accentColor ?? null,
        parsed.sector ?? null,
        parsed.industry ?? null,
        parsed.fiftyTwoWeekLow ?? null,
        parsed.fiftyTwoWeekHigh ?? null,
        parsed.regularMarketChange ?? null,
        parsed.regularMarketPreviousClose ?? null,
      ]
    );
  }

  async delete(ticker: string): Promise<void> {
    await this.db.execute('DELETE FROM tickers WHERE ticker = ?', [ticker]);
  }

  async setAccentColor(ticker: string, color: string | null): Promise<void> {
    await this.db.execute(
      'UPDATE tickers SET accent_color = ? WHERE ticker = ?',
      [color, ticker],
    );
  }

  /** Targeted 52-week write (D-PT14): UPDATE, never upsert — a missing row is
   * a no-op and a partial write can't clobber the other nine columns. */
  async set52Week(ticker: string, low: number | null, high: number | null): Promise<void> {
    await this.db.execute(
      'UPDATE tickers SET fifty_two_week_low = ?, fifty_two_week_high = ? WHERE ticker = ?',
      [low, high, ticker],
    );
  }

  /** Targeted day-change write (D-WB7): UPDATE, never upsert — a missing row
   * is a no-op and a partial write can't clobber the other eleven columns.
   * Independent of set52Week so a missing Yahoo module for one group never
   * clobbers the other group's stored values (D-WB6). */
  async setDayChange(ticker: string, change: number | null, prevClose: number | null): Promise<void> {
    await this.db.execute(
      'UPDATE tickers SET regular_market_change = ?, regular_market_previous_close = ? WHERE ticker = ?',
      [change, prevClose, ticker],
    );
  }

  async listUserAdded(): Promise<Ticker[]> {
    const rows = await this.db.select<TickerRow>(
      'SELECT * FROM tickers WHERE user_added = 1 ORDER BY ticker ASC'
    );
    return rows.map(rowToTicker);
  }
}
