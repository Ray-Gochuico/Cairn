import type { Database } from '@/db/db';
import { FundHoldingSchema, type FundHolding } from '@/types/schema';

interface FundHoldingRow {
  fund_ticker: string;
  holding_ticker: string;
  weight: number;
  as_of_date: string;
}

function rowToFundHolding(row: FundHoldingRow): FundHolding {
  return FundHoldingSchema.parse({
    fundTicker: row.fund_ticker,
    holdingTicker: row.holding_ticker,
    weight: row.weight,
    asOfDate: row.as_of_date,
  });
}

export class FundHoldingsRepo {
  constructor(private db: Database) {}

  async listForFund(fundTicker: string): Promise<FundHolding[]> {
    const rows = await this.db.select<FundHoldingRow>(
      'SELECT * FROM fund_holdings WHERE fund_ticker = ? ORDER BY weight DESC',
      [fundTicker]
    );
    return rows.map(rowToFundHolding);
  }

  async listAll(): Promise<FundHolding[]> {
    const rows = await this.db.select<FundHoldingRow>(
      'SELECT * FROM fund_holdings ORDER BY fund_ticker ASC, weight DESC'
    );
    return rows.map(rowToFundHolding);
  }

  async upsertHoldings(
    fundTicker: string,
    holdings: { symbol: string; weight: number }[],
    asOfDate: string
  ): Promise<void> {
    await this.db.execute('DELETE FROM fund_holdings WHERE fund_ticker = ?', [fundTicker]);
    for (const h of holdings) {
      // Validate via schema before insert
      FundHoldingSchema.parse({
        fundTicker,
        holdingTicker: h.symbol,
        weight: h.weight,
        asOfDate,
      });
      await this.db.execute(
        'INSERT INTO fund_holdings (fund_ticker, holding_ticker, weight, as_of_date) VALUES (?, ?, ?, ?)',
        [fundTicker, h.symbol, h.weight, asOfDate]
      );
    }
  }

  async getAsOf(fundTicker: string): Promise<string | null> {
    const rows = await this.db.select<{ max_date: string | null }>(
      'SELECT MAX(as_of_date) AS max_date FROM fund_holdings WHERE fund_ticker = ?',
      [fundTicker]
    );
    return rows[0]?.max_date ?? null;
  }

  async isStale(fundTicker: string, today: Date, staleDays: number): Promise<boolean> {
    const asOf = await this.getAsOf(fundTicker);
    if (asOf === null) return true;
    const asOfDate = new Date(asOf + 'T00:00:00Z');
    const todayUtc = new Date(
      Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
    );
    const diffMs = todayUtc.getTime() - asOfDate.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    return diffDays > staleDays;
  }
}
