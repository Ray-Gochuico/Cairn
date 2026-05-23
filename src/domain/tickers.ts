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

  async upsert(ticker: Ticker): Promise<void> {
    const parsed = TickerSchema.parse(ticker);
    await this.db.execute(
      `INSERT OR REPLACE INTO tickers (ticker, name, asset_class, leverage_factor, direction, user_added, accent_color)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        parsed.ticker,
        parsed.name,
        parsed.assetClass,
        parsed.leverageFactor,
        parsed.direction,
        parsed.userAdded ? 1 : 0,
        parsed.accentColor ?? null,
      ]
    );
  }

  async delete(ticker: string): Promise<void> {
    await this.db.execute('DELETE FROM tickers WHERE ticker = ?', [ticker]);
  }

  async listUserAdded(): Promise<Ticker[]> {
    const rows = await this.db.select<TickerRow>(
      'SELECT * FROM tickers WHERE user_added = 1 ORDER BY ticker ASC'
    );
    return rows.map(rowToTicker);
  }
}
